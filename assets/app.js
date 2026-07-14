/*
 * strongwind.dev landing page behaviour.
 *
 * Two responsibilities, both progressive enhancements over the static markup:
 *   1. Theme toggle - flips light/dark, persists the choice, keeps the button
 *      label accurate for screen readers, and follows the OS until a choice is
 *      made.
 *   2. Tool catalogue - renders every card from data. The live GitHub API is
 *      the source of truth; if it fails (rate limit on a shared IP, offline,
 *      API down) we fall back to an in-repo snapshot at /assets/repos.json.
 *      If both fail the static "browse on GitHub" fallback in the HTML stands.
 *
 * No third-party script, no framework. API values are only ever written to
 * textContent and every outbound URL is validated locally, so a hostile API
 * response has no path to inject markup or scripts.
 */
(function () {
  "use strict";

  // --- Theme toggle ---------------------------------------------------------
  var root = document.documentElement;
  var mql = window.matchMedia("(prefers-color-scheme: dark)");
  var toggle = document.getElementById("theme-toggle");

  function stored() {
    try {
      return localStorage.getItem("theme");
    } catch {
      return null;
    }
  }

  function effective() {
    return root.getAttribute("data-theme") || (mql.matches ? "dark" : "light");
  }

  function syncButton() {
    if (!toggle) return;
    var dark = effective() === "dark";
    toggle.setAttribute(
      "aria-label",
      dark ? "Switch to light theme" : "Switch to dark theme",
    );
    toggle.setAttribute("aria-pressed", String(dark));
  }

  if (toggle) {
    syncButton();
    toggle.addEventListener("click", function () {
      var next = effective() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch {
        /* ignore persistence failure */
      }
      syncButton();
    });
    // Keep the label in sync with OS changes while the user has no explicit choice.
    var onSchemeChange = function () {
      if (!stored()) syncButton();
    };
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onSchemeChange);
    } else if (typeof mql.addListener === "function") {
      mql.addListener(onSchemeChange); // older Safari
    }
  }

  // --- Footer year ----------------------------------------------------------
  var yearEl = document.getElementById("year");
  if (yearEl) {
    try {
      yearEl.textContent = String(new Date().getFullYear());
    } catch {
      /* leave the static year */
    }
  }

  // --- Tool catalogue -------------------------------------------------------
  var API =
    "https://api.github.com/users/StrongWind1/repos?per_page=100&sort=pushed";
  var CACHE = "/assets/repos.json";

  // Non-tool repos that must never render: the org profile readme and this site.
  var EXCLUDE = { "StrongWind1": 1, "StrongWind1.github.io": 1 };

  // The sole per-repo override. These are documentation, not code, and GitHub
  // misreports their language (JavaScript/Makefile), so force a Reference badge.
  var REFERENCE = { Kerberos: 1, WiFi_Cracking: 1 };

  // Published package registry URLs, keyed by repo name.
  var PACKAGES = {
    "AD-SecretGen": "https://pypi.org/project/ad-secretgen/",
    CredWolf: "https://pypi.org/project/credwolf/",
    KerbWolf: "https://pypi.org/project/kerbwolf/",
    NTDSWolf: "https://pypi.org/project/ntdswolf/",
    PassWolf: "https://pypi.org/project/passwolf/",
    ntcompress: "https://pypi.org/project/ntcompress/",
    tpwalk: "https://pypi.org/project/tpwalk/",
    WPAWolf: "https://crates.io/crates/wpawolf",
    WEPWolf: "https://crates.io/crates/wepwolf",
  };

  // Sections are derived from repo topics, rendered top to bottom. A repo joins
  // the first section whose test matches; anything unmatched falls to Network.
  var SECTIONS = [
    {
      title: "Active Directory & Windows",
      test: function (t) {
        return hasTopic(t, "active-directory");
      },
    },
    {
      title: "Wi-Fi",
      test: function (t) {
        return (
          hasTopic(t, "wifi") ||
          hasTopic(t, "wireless") ||
          t.indexOf("802-11") !== -1
        );
      },
    },
  ];
  var CATCH_ALL = "Network";

  function hasTopic(topics, needle) {
    return topics.some(function (x) {
      return x.indexOf(needle) !== -1;
    });
  }

  function sectionFor(topics) {
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].test(topics)) return SECTIONS[i].title;
    }
    return CATCH_ALL;
  }

  function langTag(repo) {
    if (REFERENCE[repo.name]) return { label: "Reference", cls: "lang-ref" };
    var lang =
      typeof repo.language === "string" && repo.language
        ? repo.language
        : "Project";
    return { label: lang, cls: "lang-" + lang.toLowerCase() };
  }

  function displayable(repo) {
    return (
      repo &&
      typeof repo.name === "string" &&
      !repo.fork &&
      !repo.archived &&
      !repo.private &&
      !EXCLUDE[repo.name]
    );
  }

  function card(repo) {
    var li = document.createElement("li");
    li.className = "item";
    li.setAttribute("data-repo", repo.name);

    var main = document.createElement("div");
    main.className = "item-main";

    var head = document.createElement("div");
    head.className = "item-head";

    var name = document.createElement("a");
    name.className = "item-name";
    // Prefer the API's own URL (survives an owner/repo rename); build one only
    // when the field is missing (e.g. a lean cache entry).
    name.href =
      typeof repo.html_url === "string" && repo.html_url
        ? repo.html_url
        : "https://github.com/StrongWind1/" + encodeURIComponent(repo.name);
    name.rel = "noopener";
    name.textContent = repo.name;

    var tag = langTag(repo);
    var lang = document.createElement("span");
    lang.className = "item-lang " + tag.cls;
    lang.textContent = tag.label;
    head.append(name, lang);

    var desc = document.createElement("p");
    desc.className = "item-desc";
    desc.textContent =
      typeof repo.description === "string" && repo.description
        ? repo.description
        : "No description provided.";
    main.append(head, desc);

    var links = document.createElement("span");
    links.className = "item-links";
    // Package registry link when the repo has a published package.
    var pkgUrl = PACKAGES[repo.name];
    if (pkgUrl) {
      var pkg = document.createElement("a");
      pkg.href = pkgUrl;
      pkg.rel = "noopener";
      pkg.textContent = pkgUrl.indexOf("crates.io") !== -1 ? "Crate" : "PyPI";
      links.append(pkg);
    }
    // Docs link only when the repo advertises a homepage (its published site).
    if (typeof repo.homepage === "string" && repo.homepage) {
      var docs = document.createElement("a");
      docs.href = repo.homepage;
      docs.rel = "noopener";
      docs.textContent = "Docs";
      links.append(docs);
    }

    var stars = document.createElement("span");
    stars.className = "stars";
    stars.setAttribute("title", "GitHub stars");
    // Reuse the gold SVG star sprite so cards match the sprite defs in the HTML.
    var SVG_NS = "http://www.w3.org/2000/svg";
    var glyph = document.createElementNS(SVG_NS, "svg");
    glyph.setAttribute("class", "ico");
    glyph.setAttribute("aria-hidden", "true");
    var glyphUse = document.createElementNS(SVG_NS, "use");
    glyphUse.setAttribute("href", "#i-star");
    glyph.appendChild(glyphUse);
    var count = document.createElement("span");
    count.className = "stars-count";
    count.textContent = String(
      typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0,
    );
    stars.append(glyph, count);
    links.append(stars);

    li.append(main, links);
    return li;
  }

  function render(repos) {
    var host = document.getElementById("tools");
    if (!host) return;
    var shown = repos.filter(displayable);
    if (!shown.length) return; // keep the fallback rather than blank the section

    // Bucket by topic-derived section.
    var buckets = {};
    shown.forEach(function (repo) {
      var topics = Array.isArray(repo.topics) ? repo.topics : [];
      var title = sectionFor(topics);
      (buckets[title] || (buckets[title] = [])).push(repo);
    });

    // Explicit sections first (in declared order), then the catch-all last.
    var order = SECTIONS.map(function (s) {
      return s.title;
    });
    if (buckets[CATCH_ALL]) order.push(CATCH_ALL);

    var frag = document.createDocumentFragment();
    order.forEach(function (title) {
      var group = buckets[title];
      if (!group || !group.length) return;
      // Most-starred first; name breaks ties so order is stable across loads.
      group.sort(function (a, b) {
        return (
          (b.stargazers_count || 0) - (a.stargazers_count || 0) ||
          a.name.localeCompare(b.name)
        );
      });
      var wrap = document.createElement("div");
      wrap.className = "group";
      var h2 = document.createElement("h2");
      h2.textContent = title;
      var ul = document.createElement("ul");
      ul.className = "list";
      group.forEach(function (repo) {
        ul.appendChild(card(repo));
      });
      wrap.append(h2, ul);
      frag.appendChild(wrap);
    });

    host.textContent = ""; // clear the static fallback before first render
    host.appendChild(frag);
  }

  function load() {
    if (typeof window.fetch !== "function") return;
    // Live API first; on any failure fall back to the in-repo snapshot.
    window
      .fetch(API, {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
      })
      .then(function (r) {
        if (!r.ok) throw new Error("api " + r.status);
        return r.json();
      })
      .then(function (repos) {
        if (!Array.isArray(repos)) throw new Error("api shape");
        render(repos);
      })
      .catch(function () {
        return window
          .fetch(CACHE, { cache: "no-cache" })
          .then(function (r) {
            if (!r.ok) throw new Error("cache " + r.status);
            return r.json();
          })
          .then(function (repos) {
            if (Array.isArray(repos)) render(repos);
          });
      })
      .catch(function () {
        /* Both sources failed; the HTML fallback link stands. */
      });
  }

  load();
})();
