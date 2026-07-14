"use strict";

/*
 * Regenerate the static tool list inside index.html from assets/repos.json.
 *
 * This is the no-JS / total-failure fallback the page ships in its HTML source.
 * It must stay byte-identical to what assets/app.js renders at runtime, so the
 * grouping, sort, and Reference override below mirror that file exactly. Output
 * is plain HTML; Prettier canonicalises whitespace afterwards (npm run
 * build:fallback), so this script never tries to match Prettier's wrapping.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "assets", "repos.json");
const PAGE = path.join(ROOT, "index.html");

// The sole per-repo override: these are documentation, and GitHub misreports
// their language (JavaScript/Makefile), so force a Reference badge.
const REFERENCE = { Kerberos: 1, WiFi_Cracking: 1 };

// Sections are derived from repo topics, rendered top to bottom; the first
// matching section wins and anything unmatched falls to the catch-all.
const SECTIONS = [
  {
    title: "Active Directory & Windows",
    test: (t) => hasTopic(t, "active-directory"),
  },
  {
    title: "Wi-Fi",
    test: (t) =>
      hasTopic(t, "wifi") ||
      hasTopic(t, "wireless") ||
      t.indexOf("802-11") !== -1,
  },
];
const CATCH_ALL = "Network";

function hasTopic(topics, needle) {
  return topics.some((x) => x.indexOf(needle) !== -1);
}

function sectionFor(topics) {
  for (const section of SECTIONS) {
    if (section.test(topics)) return section.title;
  }
  return CATCH_ALL;
}

function langTag(repo) {
  if (REFERENCE[repo.name]) return { label: "Reference", cls: "lang-ref" };
  const lang =
    typeof repo.language === "string" && repo.language
      ? repo.language
      : "Project";
  return { label: lang, cls: `lang-${lang.toLowerCase()}` };
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function repoUrl(repo) {
  if (typeof repo.html_url === "string" && repo.html_url) return repo.html_url;
  return `https://github.com/StrongWind1/${encodeURIComponent(repo.name)}`;
}

function cardHtml(repo) {
  const tag = langTag(repo);
  const desc =
    typeof repo.description === "string" && repo.description
      ? repo.description
      : "No description provided.";
  const stars =
    typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0;
  const docs =
    typeof repo.homepage === "string" && repo.homepage
      ? `\n                <a href="${esc(repo.homepage)}" rel="noopener">Docs</a>`
      : "";

  return [
    `            <li class="item" data-repo="${esc(repo.name)}">`,
    `              <div class="item-main">`,
    `                <div class="item-head">`,
    `                  <a class="item-name" href="${esc(repoUrl(repo))}" rel="noopener">${esc(repo.name)}</a>`,
    `                  <span class="item-lang ${tag.cls}">${esc(tag.label)}</span>`,
    `                </div>`,
    `                <p class="item-desc">${esc(desc)}</p>`,
    `              </div>`,
    `              <span class="item-links">${docs}`,
    `                <span class="stars" title="GitHub stars"><svg class="ico" aria-hidden="true"><use href="#i-star"></use></svg><span class="stars-count">${stars}</span></span>`,
    `              </span>`,
    `            </li>`,
  ].join("\n");
}

function build(repos) {
  const buckets = {};
  for (const repo of repos) {
    const topics = Array.isArray(repo.topics) ? repo.topics : [];
    const title = sectionFor(topics);
    (buckets[title] || (buckets[title] = [])).push(repo);
  }

  const order = SECTIONS.map((s) => s.title);
  if (buckets[CATCH_ALL]) order.push(CATCH_ALL);

  let out = "";
  for (const title of order) {
    const group = buckets[title];
    if (!group || !group.length) continue;
    // Most-starred first; name breaks ties so order is stable across runs.
    group.sort(
      (a, b) =>
        (b.stargazers_count || 0) - (a.stargazers_count || 0) ||
        a.name.localeCompare(b.name),
    );
    out += `        <div class="group">\n`;
    out += `          <h2>${esc(title)}</h2>\n`;
    out += `          <ul class="list">\n`;
    out += `${group.map(cardHtml).join("\n")}\n`;
    out += `          </ul>\n`;
    out += `        </div>\n`;
  }
  return `      <section id="tools" aria-label="Tools">\n${out}      </section>\n`;
}

function main() {
  const repos = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const section = build(repos);
  const page = fs.readFileSync(PAGE, "utf8");
  const next = page.replace(
    / {6}<section[^>]*id="tools"[^>]*>[\s\S]*?\n {6}<\/section>\n/,
    section,
  );
  if (next === page) {
    throw new Error('could not locate <section id="tools"> in index.html');
  }
  fs.writeFileSync(PAGE, next);
  process.stdout.write("regenerated #tools fallback from assets/repos.json\n");
}

main();
