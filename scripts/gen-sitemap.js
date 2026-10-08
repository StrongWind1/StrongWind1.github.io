"use strict";

/*
 * Regenerate sitemap.xml as a <sitemapindex> over the project docs sites.
 *
 * Every project publishes its own MkDocs-generated sitemap at
 * https://strongwind.dev/<Repo>/sitemap.xml. Those are the real crawl entry
 * points -- roughly 190 pages between them -- but nothing referenced them, so
 * robots.txt pointed at a root sitemap listing a single URL. This script builds
 * the index that ties them together, so Search Console needs exactly one
 * submitted URL.
 *
 * The candidate list is assets/repos.json, which refresh-repos-cache.yml already
 * rebuilds weekly from the GitHub API. A repo joins the index by setting its
 * homepage to its docs URL -- no list to maintain here.
 *
 * Each candidate is fetched before it is listed, so a repo whose Pages deploy is
 * broken never makes it into the index. A candidate that fails to fetch but is
 * already in the committed sitemap.xml is carried forward instead of dropped, so
 * a transient outage cannot silently shrink the index.
 *
 * Output is plain XML. Prettier has no XML parser, so it never touches these
 * files (*.xml is in .prettierignore to keep it that way).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "assets", "repos.json");
const INDEX_OUT = path.join(ROOT, "sitemap.xml");
const PAGES_OUT = path.join(ROOT, "sitemap-pages.xml");

const ORIGIN = "https://strongwind.dev";
const PAGES_LOC = `${ORIGIN}/sitemap-pages.xml`;
const FETCH_TIMEOUT_MS = 15000;

// A docs homepage must be a path under the apex -- the apex itself is covered by
// sitemap-pages.xml, not by a child sitemap.
const DOCS_HOMEPAGE = /^https:\/\/strongwind\.dev\/.+/;

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Pull <loc>/<lastmod> pairs out of the committed index so a child that fails to
// respond this run keeps whatever we last knew about it.
function readCommittedIndex() {
  const known = new Map();
  if (!fs.existsSync(INDEX_OUT)) return known;
  const xml = fs.readFileSync(INDEX_OUT, "utf8");
  const blocks = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g) || [];
  for (const block of blocks) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block);
    if (!loc) continue;
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(block);
    known.set(loc[1].trim(), lastmod ? lastmod[1].trim() : null);
  }
  return known;
}

// Candidate child sitemaps, derived from the homepage each repo advertises.
// Deduped because more than one repo can point at the same docs site.
function candidates() {
  const repos = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const urls = new Set();
  for (const repo of repos) {
    const home = typeof repo.homepage === "string" ? repo.homepage.trim() : "";
    if (!DOCS_HOMEPAGE.test(home)) continue;
    urls.add(`${home.replace(/\/+$/, "")}/sitemap.xml`);
  }
  return [...urls].sort();
}

// A child sitemap's newest <lastmod> is its last deploy date, which is accurate
// enough to be worth emitting. Google ignores lastmod it cannot corroborate.
function newestLastmod(xml) {
  const dates = (xml.match(/<lastmod>([^<]+)<\/lastmod>/g) || [])
    .map((m) => m.replace(/<\/?lastmod>/g, "").trim())
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

async function probe(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": "strongwind.dev sitemap generator" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  // Guard against the failure mode this whole change exists to fix: a child
  // whose site_url still points somewhere else makes the index cross-host, and
  // Google rejects that.
  const foreign = (xml.match(/<loc>([^<]+)<\/loc>/g) || []).some(
    (loc) => !loc.includes(`${ORIGIN}/`),
  );
  if (foreign) {
    console.warn(
      `  warn: ${url} lists URLs outside ${ORIGIN} -- check its site_url`,
    );
  }
  return newestLastmod(xml);
}

// Last date the landing page actually changed. Uncommitted edits mean it is
// changing right now, so today wins over whatever git last recorded.
function landingLastmod() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const dirty = execFileSync(
      "git",
      ["status", "--porcelain", "--", "index.html"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    ).trim();
    if (dirty) return today;
    const logged = execFileSync(
      "git",
      ["log", "-1", "--format=%cs", "--", "index.html"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    ).trim();
    return logged || today;
  } catch {
    return today;
  }
}

function renderIndex(entries) {
  const body = entries
    .map(({ loc, lastmod }) => {
      const date = lastmod ? `\n    <lastmod>${esc(lastmod)}</lastmod>` : "";
      return `  <sitemap>\n    <loc>${esc(loc)}</loc>${date}\n  </sitemap>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

function renderPages(lastmod) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url>\n    <loc>${ORIGIN}/</loc>\n    <lastmod>${esc(lastmod)}</lastmod>\n  </url>\n` +
    `</urlset>\n`
  );
}

async function main() {
  const committed = readCommittedIndex();
  const entries = [{ loc: PAGES_LOC, lastmod: landingLastmod() }];

  for (const loc of candidates()) {
    try {
      entries.push({ loc, lastmod: await probe(loc) });
      console.log(`  ok   ${loc}`);
    } catch (err) {
      if (committed.has(loc)) {
        // Keep the last known good entry rather than let a blip drop a site.
        entries.push({ loc, lastmod: committed.get(loc) });
        console.warn(`  keep ${loc} (${err.message}; carried forward)`);
      } else {
        console.warn(`  skip ${loc} (${err.message})`);
      }
    }
  }

  fs.writeFileSync(PAGES_OUT, renderPages(entries[0].lastmod));
  fs.writeFileSync(INDEX_OUT, renderIndex(entries));
  process.stdout.write(
    `regenerated sitemap.xml with ${entries.length - 1} project sitemap(s) + the landing page\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
