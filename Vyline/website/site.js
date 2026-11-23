import { matchesDocument, searchExcerpt } from "./navigation.js";

document.documentElement.classList.add("js");
const base = new URL("../", import.meta.url);

// Native details remains usable without JavaScript; small screens start closed.
const sidebar = document.querySelector(".sidebar-panel");
const narrow = matchMedia("(max-width: 760px)");
function setSidebar() {
  if (sidebar) sidebar.open = !narrow.matches;
}
setSidebar();
narrow.addEventListener("change", setSidebar);

// Keep links to the previous single-page directory useful.
if (location.pathname === base.pathname) {
  if (location.hash === "#docs" || location.search) {
    location.replace(new URL(`docs/${location.search}`, base));
  } else if (["#start", "#install"].includes(location.hash)) {
    location.replace(new URL("install/", base));
  }
}

const query = document.querySelector("#doc-query");
const category = document.querySelector("#doc-category");
const rows = [...document.querySelectorAll(".document-row")];
const groups = [...document.querySelectorAll("[data-doc-group]")];
const count = document.querySelector("#doc-count");
const empty = document.querySelector("#doc-empty");

function filterDirectory(writeUrl = true) {
  const value = query.value;
  const group = category.value;
  let visible = 0;
  for (const row of rows) {
    row.hidden = !matchesDocument(row.dataset, value, group);
    if (!row.hidden) visible++;
    row.querySelector(".search-match").textContent = value.trim()
      ? searchExcerpt(row.dataset.search, value, Number(row.dataset.contentOffset))
      : "";
  }
  for (const group of groups) {
    group.hidden = !group.querySelector(".document-row:not([hidden])");
    for (const link of document.querySelectorAll(`a[href="#${group.id}"]`))
      link.hidden = group.hidden;
  }
  count.textContent = `${visible} / ${rows.length} 件`;
  empty.hidden = visible !== 0;
  if (writeUrl) {
    const url = new URL(location.href);
    value ? url.searchParams.set("q", value) : url.searchParams.delete("q");
    group !== "all" ? url.searchParams.set("category", group) : url.searchParams.delete("category");
    url.hash = "";
    history.replaceState(null, "", url);
  }
}
if (query) {
  const params = new URL(location.href).searchParams;
  query.value = params.get("q") ?? "";
  category.value = [...category.options].some((option) => option.value === params.get("category"))
    ? params.get("category")
    : "all";
  filterDirectory(false);
  query.addEventListener("input", () => filterDirectory());
  category.addEventListener("change", () => filterDirectory());
  document.querySelector("#doc-reset").addEventListener("click", () => {
    query.value = "";
    category.value = "all";
    filterDirectory();
    query.focus();
  });
}

// Global search spans installation and technical Docs, using real Markdown bodies.
const dialog = document.createElement("dialog");
dialog.className = "docs-search-dialog";
dialog.setAttribute("aria-labelledby", "search-title");
dialog.innerHTML = `<div class="dialog-heading"><h2 id="search-title">資料を検索</h2><button class="dialog-close" type="button">閉じる <kbd>Esc</kbd></button></div><div class="dialog-form"><label for="global-query">導入・インストールとドキュメントを全文検索</label><input id="global-query" type="search" autocomplete="off" placeholder="記事名、設定、エラーメッセージ…"></div><div class="dialog-results" aria-live="polite"></div>`;
document.body.append(dialog);
const globalQuery = dialog.querySelector("input");
const results = dialog.querySelector(".dialog-results");
let searchIndex;
let searchRequest;
let searchError = false;

function renderResults() {
  results.replaceChildren();
  const status = document.createElement("p");
  results.append(status);
  if (searchError) {
    status.textContent =
      "検索データを読み込めませんでした。閉じて開き直すか、Docsの一覧から探してください。";
    return;
  }
  if (!searchIndex) {
    status.textContent = "検索データを読み込んでいます…";
    return;
  }
  if (!globalQuery.value.trim()) {
    status.textContent = "複数の語を空白で区切って絞り込めます。";
    return;
  }
  const matches = searchIndex.filter((doc) =>
    matchesDocument(
      { ...doc, search: `${doc.title} ${doc.summary} ${doc.category} ${doc.content}` },
      globalQuery.value,
    ),
  );
  status.textContent = matches.length
    ? `${matches.length} 件の記事`
    : "一致する記事がありません。別の語で検索してください。";
  for (const doc of matches) {
    const link = document.createElement("a");
    link.href = doc.url;
    link.className = "dialog-result";
    const section = document.createElement("small");
    section.textContent = `${doc.section === "install" ? "導入・インストール" : "Docs"} / ${doc.category}`;
    const title = document.createElement("strong");
    title.textContent = doc.title;
    const summary = document.createElement("span");
    summary.textContent = doc.summary;
    const excerpt = document.createElement("p");
    excerpt.textContent = searchExcerpt(doc.content, globalQuery.value);
    link.append(section, title, summary, excerpt);
    results.append(link);
  }
}
async function openSearch() {
  if (dialog.open) return;
  dialog.showModal();
  globalQuery.focus();
  renderResults();
  if (!searchIndex) {
    searchError = false;
    searchRequest ??= fetch(new URL("search.json", base))
      .then((response) => {
        if (!response.ok) throw new Error("Search index unavailable");
        return response.json();
      })
      .finally(() => {
        searchRequest = null;
      });
    try {
      searchIndex = await searchRequest;
    } catch {
      searchError = true;
    }
    renderResults();
  }
}
for (const trigger of document.querySelectorAll("[data-open-search]"))
  trigger.addEventListener("click", openSearch);
globalQuery.addEventListener("input", renderResults);
dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
// Search inputs consume Escape to clear their value in Chromium. Close the
// modal first so its advertised shortcut works on the first keypress.
dialog.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
    }
  },
  { capture: true },
);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
document.addEventListener("keydown", (event) => {
  const editing = event.target.closest("input, textarea, select, [contenteditable=true]");
  if (
    (event.key === "/" && !editing) ||
    ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
  ) {
    event.preventDefault();
    openSearch();
  }
});

for (const code of document.querySelectorAll("pre > code")) {
  const button = document.createElement("button");
  button.className = "copy-code";
  button.type = "button";
  button.textContent = "コピー";
  button.setAttribute("aria-label", "コードをコピー");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = "コピーしました";
    } catch {
      button.textContent = "選択してコピーしてください";
    }
    setTimeout(() => {
      button.textContent = "コピー";
    }, 2200);
  });
  code.parentElement.prepend(button);
}

const toc = [...document.querySelectorAll(".article-toc a[href^='#']")];
if (toc.length) {
  const sections = new Map(
    toc.map((link) => [document.getElementById(decodeURIComponent(link.hash.slice(1))), link]),
  );
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      for (const link of toc) link.removeAttribute("aria-current");
      sections.get(visible.target).setAttribute("aria-current", "location");
    },
    { rootMargin: "-100px 0px -55% 0px" },
  );
  for (const section of sections.keys()) if (section) observer.observe(section);
}
