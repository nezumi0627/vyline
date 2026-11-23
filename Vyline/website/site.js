import { findMatch, normalize } from "./search-text.js";

document.documentElement.classList.add("js");
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const base = new URL("../", import.meta.url);
const dialog = $(".search-dialog");
const input = $("#global-search");
const results = $(".search-results");
const count = $(".search-count");
let indexPromise;
let scope = "all";
let activeIndex = -1;
let searchRevision = 0;
let opener;
const names = { install: "導入・インストール", docs: "ガイド", wiki: "技術 Wiki" };
function getIndex() {
  if (!indexPromise)
    indexPromise = fetch(new URL("search.json", base))
      .then((response) => {
        if (!response.ok) throw new Error("Search index unavailable");
        return response.json();
      })
      .then((items) =>
        items.map((item) => ({
          ...item,
          terms: normalize(`${item.title} ${item.summary} ${item.content}`),
        })),
      )
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  return indexPromise;
}
function highlighted(text, query) {
  const fragment = document.createDocumentFragment();
  const match = findMatch(text, query);
  if (!match) {
    fragment.append(text);
    return fragment;
  }
  const { start, end } = match;
  fragment.append(text.slice(0, start));
  const mark = document.createElement("mark");
  mark.textContent = text.slice(start, end);
  fragment.append(mark, text.slice(end));
  return fragment;
}
function empty(title, detail) {
  const box = document.createElement("div");
  box.className = "search-empty";
  const strong = document.createElement("strong");
  strong.textContent = title;
  box.append(strong, detail);
  results.replaceChildren(box);
}
async function search() {
  const revision = ++searchRevision;
  const query = input.value.trim();
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  activeIndex = -1;
  count.textContent = "ドキュメントを読み込み中…";
  try {
    const index = await getIndex();
    if (revision !== searchRevision) return;
    const matches = index
      .filter(
        (item) =>
          (scope === "all" || item.section === scope) &&
          tokens.every((term) => item.terms.includes(term)),
      )
      .sort((a, b) => {
        const rank = (item) =>
          tokens.reduce(
            (score, token) =>
              score +
              (normalize(item.title).includes(token)
                ? 4
                : normalize(item.summary).includes(token)
                  ? 2
                  : 0),
            0,
          );
        return rank(b) - rank(a);
      });
    count.textContent = query
      ? `${matches.length} 件のドキュメント${matches.length > 15 ? "（先頭15件を表示）" : ""}`
      : "よく使うドキュメント";
    results.replaceChildren();
    if (!matches.length) {
      empty(
        "一致するドキュメントがありません",
        "短いキーワードにするか、検索範囲を「すべて」に変更してください。",
      );
      return;
    }
    for (const item of matches.slice(0, 15)) {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = item.url;
      const category = document.createElement("small");
      category.textContent = `${names[item.section]} / ${item.category}`;
      const title = document.createElement("strong");
      title.append(highlighted(item.title, query));
      const description = document.createElement("p");
      const first = tokens[0];
      const position = first ? (findMatch(item.content, first)?.start ?? -1) : -1;
      const excerpt =
        position < 0
          ? item.summary
          : `${position > 40 ? "…" : ""}${item.content.slice(Math.max(0, position - 40), position + 100)}…`;
      description.append(highlighted(excerpt, query));
      link.append(category, title, description);
      results.append(link);
    }
  } catch {
    if (revision !== searchRevision) return;
    count.textContent = "検索を読み込めませんでした";
    empty(
      "通信を確認して、もう一度入力してください",
      "左のガイド・Wiki一覧からもすべての記事を開けます。",
    );
  }
}
function openSearch() {
  if (dialog.open) return;
  opener = document.activeElement;
  dialog.showModal();
  input.focus();
  void search();
}
$("[data-open-search]")?.addEventListener("click", openSearch);
input?.addEventListener("input", search);
dialog?.addEventListener("close", () => opener?.focus());
dialog?.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
});
$$("[data-scope]").forEach((button) =>
  button.addEventListener("click", () => {
    scope = button.dataset.scope;
    $$("[data-scope]").forEach((other) =>
      other.setAttribute("aria-pressed", String(other === button)),
    );
    void search();
    input.focus();
  }),
);
document.addEventListener("keydown", (event) => {
  // IME candidate selection/confirmation must not navigate or close search.
  if (event.isComposing || event.keyCode === 229) return;
  const typing =
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
  if (
    ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") ||
    (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey)
  ) {
    event.preventDefault();
    openSearch();
  }
  if (!dialog?.open) return;
  if (event.key === "Escape") {
    // Search inputs otherwise consume the first Escape to clear their value.
    event.preventDefault();
    dialog.close();
    return;
  }
  const links = $$(".search-result", results);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!links.length) return;
    event.preventDefault();
    activeIndex =
      (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
    links.forEach((link, index) => link.classList.toggle("is-active", index === activeIndex));
    links[activeIndex].focus();
    links[activeIndex].scrollIntoView({ block: "nearest" });
  }
  if (event.key === "Enter" && event.target === input) {
    event.preventDefault();
    links[Math.max(0, activeIndex)]?.click();
  }
});

const platformTabs = $$("[data-platform]");
function selectPlatform() {
  if (!platformTabs.length) return;
  const id = location.hash.slice(1);
  const selected = platformTabs.find((tab) => tab.dataset.platform === id) ?? platformTabs[0];
  platformTabs.forEach((tab) => {
    const active = tab === selected;
    if (active) tab.setAttribute("aria-current", "true");
    else tab.removeAttribute("aria-current");
    const panel = document.getElementById(tab.dataset.platform);
    panel.hidden = !active;
  });
}
platformTabs.forEach((tab) =>
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    history.replaceState(null, "", tab.getAttribute("href"));
    selectPlatform();
  }),
);
window.addEventListener("hashchange", selectPlatform);
selectPlatform();

let toastTimer;
function notify(message) {
  const toast = $(".toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}
$$(".copy-code").forEach((button) =>
  button.addEventListener("click", async () => {
    const text = $("code", button.closest(".code-block")).textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "コピー済み";
      notify("コードをコピーしました");
      setTimeout(() => {
        button.textContent = "コピー";
      }, 2400);
    } catch {
      notify("コピーできませんでした。コードを選択してコピーしてください。");
    }
  }),
);
const toc = $$(".toc a[href^='#']");
if (toc.length && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (!visible) return;
      toc.forEach((link) =>
        link.classList.toggle(
          "active",
          decodeURIComponent(link.hash.slice(1)) === visible.target.id,
        ),
      );
    },
    { rootMargin: "-90px 0px -65% 0px" },
  );
  toc.forEach((link) => {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (target) observer.observe(target);
  });
}
const query = new URLSearchParams(location.search).get("q");
if (query) {
  input.value = query;
  openSearch();
}
if (
  location.pathname === base.pathname &&
  /^#(?:start|tour|explore|library|docs)(?:$|[/?])/.test(location.hash)
) {
  location.replace(new URL(/^#(?:start|tour)/.test(location.hash) ? "install/" : "docs/", base));
}
