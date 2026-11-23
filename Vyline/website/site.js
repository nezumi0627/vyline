const base = new URL("../", import.meta.url).pathname;
const search = document.querySelector("#doc-search");
const normalize = (value) => String(value).normalize("NFKC").toLocaleLowerCase("ja").replace(/[\u200b-\u200d\ufeff]/g, "");

const menuButton = document.querySelector(".menu-toggle");
const siteNav = document.querySelector("#site-nav");
if (menuButton && siteNav) {
  document.documentElement.classList.add("js");
  menuButton.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    siteNav.classList.toggle("is-open", open);
  });
  siteNav.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("a")) return;
    menuButton.setAttribute("aria-expanded", "false");
    siteNav.classList.remove("is-open");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      menuButton.setAttribute("aria-expanded", "false");
      siteNav.classList.remove("is-open");
      menuButton.focus();
    }
  });
}

if (search) {
  const rows = [...document.querySelectorAll("[data-doc-path]")];
  const groups = [...document.querySelectorAll("[data-doc-category]")];
  const count = document.querySelector("#search-status");
  let indexPromise;
  const getIndex = () => {
    indexPromise ??= fetch(`${base}search.json`).then((response) => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json();
    });
    return indexPromise;
  };

  async function filterDocuments() {
    const terms = normalize(search.value).trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      rows.forEach((row) => { row.hidden = false; });
      groups.forEach((group) => { group.hidden = false; });
      if (count) count.textContent = `${rows.length}件のドキュメント`;
      return;
    }

    try {
      const documents = await getIndex();
      const matchingPaths = new Set(documents.filter((document) => {
        const text = normalize(`${document.title} ${document.summary} ${document.category} ${document.content}`);
        return terms.every((term) => text.includes(term));
      }).map((document) => document.path));
      rows.forEach((row) => { row.hidden = !matchingPaths.has(row.dataset.docPath); });
      groups.forEach((group) => {
        group.hidden = !group.querySelector("[data-doc-path]:not([hidden])");
      });
      const resultCount = matchingPaths.size;
      if (count) count.textContent = resultCount ? `${resultCount}件見つかりました` : "一致するドキュメントはありません。検索語を変えてください。";
    } catch {
      if (count) count.textContent = "検索インデックスを読み込めませんでした。下の一覧から選べます。";
    }
  }

  search.addEventListener("input", filterDocuments);
  document.querySelector(".search-form")?.addEventListener("submit", (event) => event.preventDefault());
  if (location.hash === "#search") search.focus({ preventScroll: true });
  filterDocuments();
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return;
  event.preventDefault();
  if (search) {
    search.focus();
    return;
  }
  window.location.assign(`${base}guide/#search`);
});
