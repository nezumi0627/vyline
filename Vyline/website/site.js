import { platforms, download, version } from "./site-data.js";
import { matchesDocument, searchExcerpt } from "./navigation.js";

const base = new URL("../", import.meta.url).pathname;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

// Native anchors remain the navigation model, including without JavaScript.
const menu = $(".menu-button");
const navigation = $("#navigation");
function closeMenu() {
  menu?.setAttribute("aria-expanded", "false");
  navigation?.classList.remove("is-open");
}
menu?.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  navigation?.classList.toggle("is-open", open);
});
navigation?.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    menu?.getAttribute("aria-expanded") === "true"
  ) {
    closeMenu();
    menu.focus();
  }
});
document.documentElement.classList.add("js");
if ($(".landing-page")) {
  const aliases = {
    home: "main",
    tour: "start",
    explore: "experience",
    library: "docs",
  };
  const target = aliases[location.hash.slice(1)];
  if (target) {
    history.replaceState(null, "", `#${target}`);
    $(`#${target}`)?.scrollIntoView();
  }
}

// OS selection changes instructions, never starts a download automatically.
const installPanel = $("#install-panel");
function selectPlatform(key) {
  const platform = platforms[key];
  if (!platform || !installPanel) return;
  $$("[data-os]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.os === key)),
  );
  const guide = `${base}guide/docs/install/${platform.guide}.html`;
  installPanel.innerHTML = `<p class="eyebrow">${escapeHtml(platform.name.toUpperCase())} / v${version}</p><h3>${escapeHtml(platform.title)}</h3><p>${escapeHtml(platform.description)}</p><div class="install-links"><a class="button button-primary" href="${platform.file ? download(platform.file) : guide}">${escapeHtml(platform.label)} <span aria-hidden="true">↗</span></a>${platform.file ? `<a class="text-link" href="${guide}">導入ガイドを読む →</a>` : ""}</div>${platform.command ? `<pre><code>${escapeHtml(platform.command)}</code></pre>` : ""}<p class="install-note">${escapeHtml(platform.note)}</p>`;
  enhanceCodeBlocks(installPanel);
}
$$("[data-os]").forEach((button) =>
  button.addEventListener("click", () => selectPlatform(button.dataset.os)),
);
if (installPanel) selectPlatform("windows");

// Search the generated Markdown body, not just page titles. Keep state in the URL.
const search = $("#doc-search");
if (search) {
  let category = "all";
  const params = new URLSearchParams(location.search);
  search.value = params.get("q") ?? "";
  const buttons = $$("[data-category-filter]");
  if (
    buttons.some(
      (button) => button.dataset.categoryFilter === params.get("category"),
    )
  )
    category = params.get("category");
  const rows = $$("#document-list .document-row");
  function filter(updateUrl = true) {
    let count = 0;
    rows.forEach((row) => {
      const visible = matchesDocument(
        { category: row.dataset.category, search: row.dataset.search },
        search.value,
        category,
      );
      row.hidden = !visible;
      if (visible) count++;
      const match = $(".search-match", row);
      if (match)
        match.textContent = visible
          ? searchExcerpt(
              row.dataset.search,
              search.value,
              Number(row.dataset.contentOffset),
            )
          : "";
    });
    buttons.forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.categoryFilter === category),
      ),
    );
    $("#result-count").textContent = `${count} / ${rows.length} docs`;
    $("#search-empty").hidden = count > 0;
    if (updateUrl) {
      const url = new URL(location.href);
      url.hash = "docs";
      search.value.trim()
        ? url.searchParams.set("q", search.value.trim())
        : url.searchParams.delete("q");
      category !== "all"
        ? url.searchParams.set("category", category)
        : url.searchParams.delete("category");
      history.replaceState(null, "", url);
    }
  }
  $(".search-form").addEventListener("submit", (event) =>
    event.preventDefault(),
  );
  search.addEventListener("input", () => filter());
  buttons.forEach((button) =>
    button.addEventListener("click", () => {
      category = button.dataset.categoryFilter;
      filter();
    }),
  );
  $("#reset-search")?.addEventListener("click", () => {
    search.value = "";
    category = "all";
    filter();
    search.focus();
  });
  filter(false);
}

async function copyCode(code, button) {
  try {
    await navigator.clipboard.writeText(code.textContent);
    button.textContent = "コピーしました";
  } catch {
    button.textContent = "コピーできませんでした";
  }
  setTimeout(() => {
    button.textContent = "コピー";
  }, 2200);
}
function enhanceCodeBlocks(root = document) {
  $$("pre", root).forEach((pre) => {
    if ($(".copy-code", pre) || !$("code", pre)) return;
    const button = document.createElement("button");
    button.className = "copy-code";
    button.type = "button";
    button.textContent = "コピー";
    button.setAttribute("aria-label", "コードをコピー");
    button.setAttribute("aria-live", "polite");
    button.addEventListener("click", () => copyCode($("code", pre), button));
    pre.prepend(button);
  });
}
enhanceCodeBlocks();

// All generated guides share an in-place search dialog and a mobile index.
const sidebar = $(".article-sidebar");
let searchDialog;
if (sidebar) {
  document.body.classList.add("docs-page");
  const layout = $(".article-layout");
  const tools = document.createElement("div");
  tools.className = "docs-tools";
  tools.innerHTML =
    '<button class="button" type="button" data-open-search>ドキュメントを検索 <span aria-hidden="true">/</span></button>';
  sidebar.prepend(tools);
  const indexToggle = document.createElement("button");
  indexToggle.className = "docs-index-toggle";
  indexToggle.type = "button";
  indexToggle.innerHTML = 'ドキュメント一覧 <span aria-hidden="true">＋</span>';
  sidebar.id = "docs-index";
  indexToggle.setAttribute("aria-controls", sidebar.id);
  indexToggle.setAttribute("aria-expanded", "false");
  indexToggle.addEventListener("click", () => {
    const open = indexToggle.getAttribute("aria-expanded") !== "true";
    indexToggle.setAttribute("aria-expanded", String(open));
    sidebar.classList.toggle("is-open", open);
  });
  layout.prepend(indexToggle);
  searchDialog = document.createElement("dialog");
  searchDialog.className = "docs-search-dialog";
  searchDialog.setAttribute("aria-labelledby", "dialog-search-title");
  searchDialog.innerHTML =
    '<div class="dialog-heading"><h2 id="dialog-search-title">ドキュメントを検索</h2><button class="dialog-close" type="button">閉じる ×</button></div><form role="search"><label class="sr-only" for="guide-search">検索キーワード</label><div class="search-field"><input id="guide-search" type="search" placeholder="テーマ、バックアップ、Docker…" autocomplete="off"></div></form><div class="dialog-results" aria-live="polite"><p>キーワードを入力してください。</p></div>';
  document.body.append(searchDialog);
  $(".dialog-close", searchDialog).addEventListener("click", () =>
    searchDialog.close(),
  );
  searchDialog.addEventListener("click", (event) => {
    if (event.target !== searchDialog) return;
    const rect = searchDialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      searchDialog.close();
  });
  $("form", searchDialog).addEventListener("submit", (event) =>
    event.preventDefault(),
  );
  let records;
  let loading;
  let activeQuery = 0;
  async function updateGuideSearch() {
    const requestId = ++activeQuery;
    const input = $("#guide-search");
    const query = input.value.trim();
    const results = $(".dialog-results", searchDialog);
    if (!query) {
      results.innerHTML = "<p>キーワードを入力してください。</p>";
      return;
    }
    results.innerHTML = "<p>検索しています…</p>";
    try {
      if (!loading)
        loading = fetch(`${base}search.json`)
          .then((response) => {
            if (!response.ok) throw new Error("Search index unavailable");
            return response.json();
          })
          .then((value) => {
            records = value;
          })
          .catch((error) => {
            loading = undefined;
            throw error;
          });
      await loading;
      // The lightweight index covers titles and summaries. Full body search is linked below.
      if (requestId !== activeQuery) return;
      const matches = records.filter((doc) =>
        matchesDocument(
          {
            category: doc.category,
            search: `${doc.title} ${doc.summary} ${doc.category}`,
          },
          query,
        ),
      );
      results.innerHTML = matches.length
        ? matches
            .map(
              (doc) =>
                `<a class="document-row" href="${escapeHtml(doc.url)}"><span class="doc-category">${escapeHtml(doc.category)}</span><span><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.summary)}</small></span><span aria-hidden="true">↗</span></a>`,
            )
            .join("")
        : "<p>タイトル・概要に一致する資料がありません。</p>";
      const fullSearch = document.createElement("a");
      fullSearch.className = "text-link";
      fullSearch.href = `${base}?q=${encodeURIComponent(query)}#docs`;
      fullSearch.textContent = "本文を含めてすべての資料から探す →";
      results.append(fullSearch);
    } catch {
      if (requestId === activeQuery)
        results.innerHTML = `<p>検索情報を読み込めませんでした。<a class="text-link" href="${base}#docs">ドキュメント一覧へ →</a></p>`;
    }
  }
  $("#guide-search").addEventListener("input", updateGuideSearch);
  $("[data-open-search]").addEventListener("click", () => {
    searchDialog.showModal();
    $("#guide-search").focus();
  });
  const headings = $$(".article-content h2[id]");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (!visible) return;
        $$(".article-toc a").forEach((link) => {
          if (decodeURIComponent(link.hash.slice(1)) === visible.target.id)
            link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      },
      { rootMargin: "-10% 0px -65% 0px" },
    );
    headings.forEach((heading) => observer.observe(heading));
  }
}
document.addEventListener("keydown", (event) => {
  const typing = event.target.closest(
    "input,textarea,select,[contenteditable=true]",
  );
  if (
    event.key !== "/" ||
    typing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (search) {
    event.preventDefault();
    const url = new URL(location.href);
    url.hash = "docs";
    history.replaceState(null, "", url);
    search.focus();
  } else if (searchDialog && !searchDialog.open) {
    event.preventDefault();
    searchDialog.showModal();
    $("#guide-search").focus();
  }
});
