import { platforms, download, version } from "./site-data.js";
import { guideIntents, routeFromHash } from "./navigation.js";

const base = new URL("../", import.meta.url).pathname;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pointerParallax = false;
if ($(".article-layout")) document.body.classList.add("docs-page");
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const normalizeSearch = (text) => String(text).normalize("NFKC").toLocaleLowerCase("ja").replace(/[\u200b-\u200d\ufeff]/g, "");
let toastTimer;

// Embedded brand marks keep the generated site self-contained; each mark remains its owner's trademark.
const platformIcons = {
  bun: '<svg class="platform-icon platform-icon-mono" viewBox="0 0 24 24" fill="#000" aria-hidden="true"><path d="M12 22.596c6.628 0 12-4.338 12-9.688 0-3.318-2.057-6.248-5.219-7.986-1.286-.715-2.297-1.357-3.139-1.89C14.058 2.025 13.08 1.404 12 1.404c-1.097 0-2.334.785-3.966 1.821a49.92 49.92 0 0 1-2.816 1.697C2.057 6.66 0 9.59 0 12.908c0 5.35 5.372 9.687 12 9.687v.001ZM10.599 4.715c.334-.759.503-1.58.498-2.409 0-.145.202-.187.23-.029.658 2.783-.902 4.162-2.057 4.624-.124.048-.199-.121-.103-.209a5.763 5.763 0 0 0 1.432-1.977Zm2.058-.102a5.82 5.82 0 0 0-.782-2.306v-.016c-.069-.123.086-.263.185-.172 1.962 2.111 1.307 4.067.556 5.051-.082.103-.23-.003-.189-.126a5.85 5.85 0 0 0 .23-2.431Zm1.776-.561a5.727 5.727 0 0 0-1.612-1.806v-.014c-.112-.085-.024-.274.114-.218 2.595 1.087 2.774 3.18 2.459 4.407a.116.116 0 0 1-.049.071.11.11 0 0 1-.153-.026.122.122 0 0 1-.022-.083 5.891 5.891 0 0 0-.737-2.331Zm-5.087.561c-.617.546-1.282.76-2.063 1-.117 0-.195-.078-.156-.181 1.752-.909 2.376-1.649 2.999-2.778 0 0 .155-.118.188.085 0 .304-.349 1.329-.968 1.874Zm4.945 11.237a2.957 2.957 0 0 1-.937 1.553c-.346.346-.8.565-1.286.62a2.178 2.178 0 0 1-1.327-.62 2.955 2.955 0 0 1-.925-1.553.244.244 0 0 1 .064-.198.234.234 0 0 1 .193-.069h3.965a.226.226 0 0 1 .19.07c.05.053.073.125.063.197Zm-5.458-2.176a1.862 1.862 0 0 1-2.384-.245 1.98 1.98 0 0 1-.233-2.447c.207-.319.503-.566.848-.713a1.84 1.84 0 0 1 1.092-.11c.366.075.703.261.967.531a1.98 1.98 0 0 1 .408 2.114 1.931 1.931 0 0 1-.698.869v.001Zm8.495.005a1.86 1.86 0 0 1-2.381-.253 1.964 1.964 0 0 1-.547-1.366c0-.384.11-.76.32-1.079.207-.319.503-.567.849-.713a1.844 1.844 0 0 1 1.093-.108c.367.076.704.262.968.534a1.98 1.98 0 0 1 .4 2.117 1.932 1.932 0 0 1-.702.868Z"/></svg>',
  windows: '<svg class="platform-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M1 3.1 10.7 1.8v9.1H1z"/><path fill="#7FBA00" d="M12 1.6 23 0v10.9H12z"/><path fill="#00A4EF" d="M1 12.1h9.7v9.1L1 19.8z"/><path fill="#FFB900" d="M12 12.1h11v10.8L12 21.4z"/></svg>',
  linux: '<svg class="platform-icon" viewBox="0 0 24 24" fill="#FCC624" aria-hidden="true"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537-.06-.003-.12 0-.18 0-.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332-.198.2-.452.4-.69.468zm-1.082-1.583v-.02c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02z"/></svg>',
  macos: '<svg class="platform-icon platform-icon-mono" viewBox="0 0 24 24" fill="#000" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>',
  docker: '<svg class="platform-icon" viewBox="0 0 24 24" fill="#2496ED" aria-hidden="true"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/></svg>',
};
$$('[data-platform-icon]').forEach((slot) => {
  const platform = slot.closest("[data-os]")?.dataset.os;
  if (platformIcons[platform]) slot.innerHTML = platformIcons[platform];
});

// Each chalk-like star has its own path, fall speed, and starting point.
const sky = $(".article-layout") ? $(".world-background") : null;
if (sky) {
  const moon = document.createElement("span");
  moon.className = "sky-moon";
  moon.innerHTML = '<svg viewBox="0 0 100 120" aria-hidden="true"><path d="M68 8C29 15 13 43 17 70c4 28 30 44 57 39-18-8-28-25-25-46C52 42 60 22 68 8Z"/><path d="M66 13C35 22 20 46 22 70c2 23 23 37 45 36"/></svg>';
  sky.append(moon);
  for (let index = 0; index < 26; index++) {
    const star = document.createElement("span");
    const size = 9 + ((index * 13) % 15);
    const duration = 17 + ((index * 7) % 19);
    const delay = -((index * 11) % duration);
    star.className = `sky-star sky-star-${index % 4}`;
    star.style.cssText = `--sky-x:${(index * 37 + 9) % 100}%;--sky-y:${(index * 43 + 7) % 90}vh;--sky-size:${size}px;--sky-duration:${duration}s;--sky-delay:${delay}s;--sky-drift:${((index % 7) - 3) * 24}px;--sky-turn:${index % 2 ? 48 : -48}deg;`;
    star.innerHTML = index % 3 === 0
      ? '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2C14 9 10 14 3 16c7 2 11 6 13 14 2-8 6-12 13-14C22 14 18 9 16 2Z"/><path d="M16 5c-2 6-5 9-10 11 5 2 8 5 10 11 2-6 5-9 10-11-5-2-8-5-10-11Z"/></svg>'
      : '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c-1 7-5 11-12 13 7 2 11 6 12 13 2-7 6-11 13-13-7-2-11-6-13-13Z"/></svg>';
    sky.append(star);
  }
}

// Docs headings use one restrained line icon family to make long pages easier to scan.
const article = $(".article-content");
if (article) {
  const icons = {
    start: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    install: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 17v4h14v-4"/>',
    architecture: '<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/><path d="M10 7h4v10"/>',
    data: '<path d="M4 7h16v13H4z"/><path d="M3 4h18M8 11h8m-8 4h8"/>',
    privacy: '<path d="M12 3 20 6v5c0 5-3.3 8-8 10-4.7-2-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/>',
    theme: '<path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.4-3.4 1.8 1.8 0 0 1 1.3-3.1H18a3 3 0 0 0 3-3c0-4.7-4-8.5-9-8.5Z"/><path d="M7.5 10h.01M10 7.5h.01M14 7.5h.01"/>',
    operations: '<path d="M14 6a5 5 0 0 0-6.4 6.4L3 17l4 4 4.6-4.6A5 5 0 0 0 18 10l-3 3-4-4z"/>',
    default: '<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v6h5M8 13h8m-8 4h8"/>',
  };
  const iconFor = (text) => {
    if (/install|導入|インストール|はじめ|使い始め|ログイン/i.test(text)) return icons.install;
    if (/architecture|構成|データフロー|設計|protocol|通信/i.test(text)) return icons.architecture;
    if (/data|データ|バックアップ|履歴|復元/i.test(text)) return icons.data;
    if (/privacy|プライバシー|安全|保護|セキュリティ/i.test(text)) return icons.privacy;
    if (/theme|テーマ|表示|外観/i.test(text)) return icons.theme;
    if (/update|運用|開発|トラブル|診断|contribut/i.test(text)) return icons.operations;
    if (/guide|使い方|機能/i.test(text)) return icons.start;
    return icons.default;
  };
  $$('h1, h2', article).forEach((heading) => {
    const icon = document.createElement("span");
    icon.className = `chapter-icon${heading.tagName === "H1" ? " chapter-icon-large" : ""}`;
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${iconFor(heading.textContent ?? "")}</svg>`;
    heading.prepend(icon);
  });
  // The Markdown source is already linked in the global header; remove the duplicate footer link row.
  $(".article-source", article)?.remove();
}

function notify(message) {
  const toast = $("#status-message"); if (!toast) return;
  toast.textContent = message; toast.classList.add("visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
}

const menuButton = $(".menu-button");
function closeMenu() { menuButton?.setAttribute("aria-expanded", "false"); $("#navigation")?.classList.remove("open"); }
menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(open)); $("#navigation").classList.toggle("open", open);
});
$("#navigation")?.addEventListener("click", (event) => { if (event.target.closest("a")) closeMenu(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuButton?.getAttribute("aria-expanded") === "true") { closeMenu(); menuButton.focus(); }
  if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "") && $("#doc-search")) { event.preventDefault(); $("#doc-search").focus(); }
});

function showRoute() {
  const route = routeFromHash(location.hash);
  document.body.dataset.view = route;
  $$('[data-view]').forEach((view) => { view.hidden = view.dataset.view !== route; });
  $$("[data-route-link]").forEach((link) => {
    if (link.dataset.routeLink === route) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
  const footer = $(".site-footer"); if (footer) footer.hidden = route === "home";
  closeMenu();
}
window.addEventListener("hashchange", () => showRoute());
window.addEventListener("popstate", () => showRoute());
showRoute();

// The atmosphere follows the reader gently; it never captures scrolling.
let frame = 0;
function updateAtmosphere() {
  frame = 0;
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  document.documentElement.style.setProperty("--page-travel", `${Math.min(1, scrollY / max)}`);
  document.documentElement.style.setProperty("--pointer-x", `${pointerParallax ? (window.__vylinePointer?.x ?? .5) - .5 : 0}`);
  document.documentElement.style.setProperty("--pointer-y", `${pointerParallax ? (window.__vylinePointer?.y ?? .5) - .5 : 0}`);
}
function scheduleAtmosphere() { if (!frame) frame = requestAnimationFrame(updateAtmosphere); }
addEventListener("scroll", scheduleAtmosphere, { passive: true });
addEventListener("resize", scheduleAtmosphere, { passive: true });
if (pointerParallax) addEventListener("pointermove", (event) => {
  window.__vylinePointer = { x: event.clientX / innerWidth, y: event.clientY / innerHeight };
  scheduleAtmosphere();
}, { passive: true });
scheduleAtmosphere();

const panel = $("#tour-panel");
if (panel) {
  const readState = () => {
    const params = new URL(location.href).searchParams;
    const os = Object.hasOwn(platforms, params.get("os")) ? params.get("os") : "bun";
    const raw = Number(params.get("step"));
    return { os, step: Number.isInteger(raw) && raw >= 0 && raw <= 2 ? raw : 0 };
  };
  let state = readState();
  function render(focus = false) {
    const platform = platforms[state.os];
    $("#tour-coordinate").textContent = `0${state.step + 1} / 03`;
    $("#selected-platform").textContent = platform.name;
    $$('[data-step]').forEach((button) => button.dataset.step === String(state.step) ? button.setAttribute("aria-current", "step") : button.removeAttribute("aria-current"));
    $$('[data-os]').forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.os === state.os)));
    $("#tour-back").disabled = state.step === 0;
    $("#tour-next").innerHTML = state.step === 2 ? '使い方を探す <span aria-hidden="true">↗</span>' : '次へ <span aria-hidden="true">→</span>';
    $("#tour-hint").textContent = ["コマンドを実行したら、ログインへ。", "ログインできたら、表示を整えます。", "必要な設定を、目的から探せます。"][state.step];
    if (state.step === 0) {
      const guide = `${base}guide/docs/install/${platform.guide}.html`;
      const portableLink = platform.file
        ? `<a class="text-link" href="${download(`Vyline-portable-${version}.zip`)}">ポータブルZIPを選ぶ ↗</a>`
        : "";
      const commandPanel = platform.command
        ? `<div class="install-command"><div class="code-block"><header><span>${state.os === "macos" ? "Terminal / Bun + Git" : state.os === "bun" ? "Terminal / PowerShell" : "Terminal"}</span><button class="mini-button" data-copy-command>コピー</button></header><pre><code>${escapeHtml(platform.command)}</code></pre></div></div>`
        : "";
      panel.innerHTML = `<div class="install-stage${platform.command ? "" : " no-command"}"><div class="install-copy"><h3>${platform.title}</h3><p class="tour-intro">${platform.description}</p><div class="install-actions"><a class="next-button" href="${platform.file ? download(platform.file) : guide}">${platform.label} <span aria-hidden="true">↗</span></a>${platform.file ? `<a class="text-link" href="${guide}">導入の詳細 ↗</a>` : ""}</div>${portableLink}<p class="quiet-note">${platform.note}</p></div>${commandPanel}</div>`;
    } else if (state.step === 1) {
      panel.innerHTML = `<h3>スマホのLINEで、つなぐ。</h3><p class="tour-intro">ここからは起動したVylineの画面で進めます。このサイトはログイン情報を受け取りません。</p><ol class="checklist"><li><div>VylineでQRコードログインを選ぶ<small>アプリ側に表示されたQRコードを使用します。</small></div></li><li><div>スマホのLINEで読み取る<small>LINEのQRコードリーダーを開き、ログインを承認します。確認番号が出た場合は画面の案内に従ってください。</small></div></li><li><div>初回設定を進める<small>ログイン後のVyline Setupで利用方法とアカウントごとの設定を選びます。</small></div></li></ol><a class="text-link" href="${base}guide/docs/start-here.html">ログインに困ったら ↗</a>`;
    } else {
      panel.innerHTML = `<h3>使いやすい場所に、整える。</h3><p class="tour-intro">インストールと初回設定の次は、使い方を選びます。必要なときに、必要な設定だけ読めます。</p><ol class="checklist"><li><div>テーマや表示を選ぶ<small>テーマ、文字サイズ、表示密度を自分に合わせます。</small></div></li><li><div>必要なデータを残す<small>会話のバックアップと設定の引継ぎは、保存する内容が異なります。</small></div></li><li><div>困ったときは原因から探す<small>ログイン、更新、診断のガイドへ進めます。</small></div></li></ol><a class="text-link" href="#docs">目的から使い方を探す ↗</a>`;
    }
    if (focus) panel.focus({ preventScroll: true });
  }
  function update(next, focus = true) {
    state = { ...state, ...next };
    const url = new URL(location.href); url.searchParams.set("os", state.os); url.searchParams.set("step", String(state.step)); url.hash = "start";
    history.pushState({}, "", url); render(focus);
  }
  $("#tour").addEventListener("click", async (event) => {
    const osButton = event.target.closest("[data-os]");
    const stepButton = event.target.closest("[data-step]");
    if (osButton) { update({ os: osButton.dataset.os }, false); panel.querySelector(`[data-os="${state.os}"]`)?.focus({ preventScroll: true }); }
    if (stepButton) update({ step: Number(stepButton.dataset.step) });
    if (event.target.closest("[data-copy-command]")) {
      try { await navigator.clipboard.writeText(platforms[state.os].command); notify("コマンドをコピーしました"); }
      catch { notify("コピーできませんでした。表示中のコマンドを選択してコピーしてください。"); }
    }
  });
  $("#tour-back").addEventListener("click", () => update({ step: Math.max(0, state.step - 1) }));
  $("#tour-next").addEventListener("click", () => state.step < 2 ? update({ step: state.step + 1 }) : (location.hash = "docs"));
  window.addEventListener("popstate", () => { state = readState(); render(); });
  render();
}

const story = $("#about-story");
if (story) {
  const chapters = [
    { coordinate: "01 / A different way to LINE", title: "いつものLINEを、<br>自分の環境で。", body: "Vylineは、LINEの会話を送受信するオープンソースの非公式クライアントです。WindowsやLinuxで動かしたり、自分のサーバーに置いてブラウザから使ったりできます。", aside: "LINE株式会社およびLY Corporationによる公式アプリではありません。", link: "利用前に確認すること", href: `${base}guide/docs/user-guide/privacy-and-data.html`, next: "何ができる？" },
    { coordinate: "02 / Built for your conversations", title: "会話のそばに、<br>自分の工夫を。", body: "画像やスタンプ、Flexメッセージを会話の流れに合わせて表示。テーマと表示密度を整え、履歴とメディアはVylineBackupで自分の手元に保存できます。", aside: "機能ごとの対応範囲と検証状況は、機能ガイドで確認できます。", link: "機能と対応状況", href: `${base}guide/docs/features.html`, next: "データはどこに？" },
    { coordinate: "03 / Your machine, your data", title: "データの置き場所を、<br>自分で選ぶ。", body: "Vylineは自分のPCやサーバーで動かせます。保存先や外部への通信を確かめてから、使う環境を決められます。", aside: "バックアップ、設定引継ぎ、iOS履歴の取り込みは、それぞれ保存できる内容が異なります。", link: "データの扱いを読む", href: `${base}guide/docs/user-guide/privacy-and-data.html`, next: "最初の一歩へ" },
  ];
  let active = 0;
  function renderStory(index) {
    active = index; const chapter = chapters[index];
    story.classList.add("is-changing");
    $$("[data-about]").forEach((button) => button.setAttribute("aria-current", String(Number(button.dataset.about) === index)));
    $(".story-coordinate", story).textContent = chapter.coordinate;
    $("#explore-title").innerHTML = chapter.title;
    $(".story-copy", story).textContent = chapter.body;
    $(".story-aside", story).textContent = chapter.aside;
    $(".story-link", story).href = chapter.href; $(".story-link", story).textContent = `${chapter.link} ↗`;
    $("[data-about-next]", story).innerHTML = `${chapter.next} <span aria-hidden="true">→</span>`;
    requestAnimationFrame(() => story.classList.remove("is-changing"));
  }
  $$('[data-about]').forEach((button) => button.addEventListener("click", () => renderStory(Number(button.dataset.about))));
  $("[data-about-next]", story).addEventListener("click", () => active < 2 ? renderStory(active + 1) : (location.hash = "start"));
  renderStory(0);
}

const finder = $("#intent-picker");
const result = $("#intent-result");
if (finder && result) {
  function renderIntent(key) {
    if (key === "install") { location.hash = "start"; return; }
    const intent = guideIntents[key];
    if (!intent) return;
    if (intent.choices) {
      result.innerHTML = `<button class="finder-back" data-intent-back>← やりたいことに戻る</button><p class="finder-prompt">${intent.question}</p><div class="intent-choices">${intent.choices.map(([title, summary, path]) => `<a class="intent-choice" href="${base}guide/${path.replace(/\.md$/, ".html")}"><span><strong>${title}</strong><small>${summary}</small></span><span aria-hidden="true">↗</span></a>`).join("")}</div>`;
    } else {
      result.innerHTML = `<button class="finder-back" data-intent-back>← やりたいことに戻る</button><p class="finder-prompt">${intent.question}</p><p class="intent-answer">${intent.description}</p><a class="intent-choice" href="${base}guide/${intent.path.replace(/\.md$/, ".html")}"><span><strong>${intent.title}</strong><small>手順と設定の詳しい説明を読む</small></span><span aria-hidden="true">↗</span></a>`;
    }
    finder.hidden = true; result.hidden = false; result.focus({ preventScroll: true });
  }
  finder.addEventListener("click", (event) => { const button = event.target.closest("[data-intent]"); if (button) renderIntent(button.dataset.intent); });
  result.addEventListener("click", (event) => { if (event.target.closest("[data-intent-back]")) { result.hidden = true; finder.hidden = false; $("[data-intent='data']", finder).focus(); } });
}

const search = $("#doc-search");
if (search) {
  const rows = $$(".document-row");
  const list = $("#document-list");
  const countNode = $("#result-count");
  const empty = $("#search-empty");
  const excerptFor = (row, terms) => {
    const source = row.dataset.search ?? "";
    const body = source.slice(Number(row.dataset.contentOffset ?? 0)).replace(/[`#*_|<>\[\]()!]/g, " ").replace(/\s+/g, " ").trim();
    const normalized = normalizeSearch(body);
    const term = terms.find((item) => normalized.includes(item));
    if (!term) return row.dataset.summary ?? "";
    const position = normalized.indexOf(term);
    const start = Math.max(0, position - 52);
    const end = Math.min(body.length, position + term.length + 92);
    return `${start ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
  };
  function filter() {
    const query = normalizeSearch(search.value).trim();
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = terms.length ? rows.map((row) => {
      const title = normalizeSearch(row.dataset.title ?? "");
      const summary = normalizeSearch(row.dataset.summary ?? "");
      const category = normalizeSearch(row.dataset.category ?? "");
      const content = normalizeSearch(row.dataset.search ?? "");
      if (!terms.every((term) => content.includes(term))) return null;
      const score = terms.reduce((total, term) => total + (title.includes(term) ? 12 : 0) + (summary.includes(term) ? 6 : 0) + (category.includes(term) ? 3 : 0) + (content.includes(term) ? 1 : 0), 0);
      return { row, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score) : [];
    matches.forEach(({ row }) => {
      row.hidden = false;
      row.dataset.searchResult = "true";
      $(".search-match", row).textContent = excerptFor(row, terms);
      list.append(row);
    });
    rows.filter((row) => !matches.some((match) => match.row === row)).forEach((row) => { row.hidden = true; delete row.dataset.searchResult; });
    list.hidden = matches.length === 0;
    empty.hidden = terms.length === 0 || matches.length > 0;
    empty.textContent = `「${search.value.trim()}」に一致する記事はありません。別の言葉で検索するか、左側の目的から選んでください。`;
    countNode.textContent = terms.length ? `${matches.length} 件の記事が見つかりました` : "検索語を入力するか、上の項目を選んでください。";
  }
  $(".search-form").addEventListener("submit", (event) => event.preventDefault());
  search.addEventListener("input", filter); filter();
  $$("[data-search-term]").forEach((button) => button.addEventListener("click", () => {
    search.value = button.dataset.searchTerm ?? "";
    filter();
    search.focus();
  }));
}
