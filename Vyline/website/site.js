import { platforms, download, version } from "./site-data.js";
import { guideIntents, routeFromHash } from "./navigation.js";

const base = new URL("../", import.meta.url).pathname;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
let toastTimer;
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
  document.documentElement.style.setProperty("--pointer-x", `${(window.__vylinePointer?.x ?? .5) - .5}`);
  document.documentElement.style.setProperty("--pointer-y", `${(window.__vylinePointer?.y ?? .5) - .5}`);
}
function scheduleAtmosphere() { if (!frame) frame = requestAnimationFrame(updateAtmosphere); }
addEventListener("scroll", scheduleAtmosphere, { passive: true });
addEventListener("resize", scheduleAtmosphere, { passive: true });
addEventListener("pointermove", (event) => {
  window.__vylinePointer = { x: event.clientX / innerWidth, y: event.clientY / innerHeight };
  scheduleAtmosphere();
}, { passive: true });
scheduleAtmosphere();

const panel = $("#tour-panel");
if (panel) {
  const chooser = panel.innerHTML;
  const readState = () => {
    const params = new URL(location.href).searchParams;
    const os = Object.hasOwn(platforms, params.get("os")) ? params.get("os") : "bun";
    const raw = Number(params.get("step"));
    return { os, step: Number.isInteger(raw) && raw >= 0 && raw <= 3 ? raw : 0 };
  };
  let state = readState();
  function render(focus = false) {
    const platform = platforms[state.os];
    $("#tour-coordinate").textContent = `Step 0${state.step + 1} / 04`;
    $("#selected-platform").textContent = platform.name;
    $$('[data-step]').forEach((button) => button.dataset.step === String(state.step) ? button.setAttribute("aria-current", "step") : button.removeAttribute("aria-current"));
    $("#tour-back").disabled = state.step === 0;
    $("#tour-next").innerHTML = state.step === 3 ? '使い方を探す <span aria-hidden="true">↗</span>' : '次へ <span aria-hidden="true">→</span>';
    $("#tour-hint").textContent = ["選んだ環境の手順へ", "インストールはご自身で確認してから次へ", "ログインはアプリ側で行います", "見た目やデータの扱いを整える"][state.step];
    if (state.step === 0) {
      panel.innerHTML = chooser;
      $$('[data-os]', panel).forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.os === state.os)));
    } else if (state.step === 1) {
      const guide = `${base}guide/docs/install/${platform.guide}.html`;
      panel.innerHTML = `<h3>${platform.title}</h3><p class="tour-intro">${platform.description}</p><div class="install-actions"><a class="next-button" href="${platform.file ? download(platform.file) : guide}">${platform.label} <span aria-hidden="true">↗</span></a>${platform.file ? `<a class="text-link" href="${guide}">詳しい手順と困ったとき ↗</a>` : ""}</div>${platform.command ? `<div class="code-block"><header><span>${state.os === "macos" ? "Terminal / Git + Bun 1.4.0+" : "Terminal"}</span><button class="mini-button" data-copy-command>コピー</button></header><pre><code>${escapeHtml(platform.command)}</code></pre></div>` : `<a class="text-link" href="${download(`Vyline-portable-${version}.zip`)}">ポータブルZIPを選ぶ ↗</a>`}<p class="quiet-note">${platform.note}</p><p class="quiet-note">SHA-256は<a href="${download("SHA256SUMS.txt")}">配布元の一覧</a>で確認できます。</p>`;
    } else if (state.step === 2) {
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
  $(".tour-shell").addEventListener("click", async (event) => {
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
  $("#tour-next").addEventListener("click", () => state.step < 3 ? update({ step: state.step + 1 }) : (location.hash = "docs"));
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
  function filter() {
    const terms = search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    let count = 0;
    rows.forEach((row) => { const match = terms.length > 0 && terms.every((term) => row.dataset.search.includes(term)); row.hidden = !match; if (match) count++; });
    list.hidden = terms.length === 0 || count === 0; empty.hidden = terms.length === 0 || count !== 0;
    countNode.textContent = terms.length ? `${count} 件の候補` : "";
  }
  $(".search-form").addEventListener("submit", (event) => event.preventDefault());
  search.addEventListener("input", filter); filter();
}
