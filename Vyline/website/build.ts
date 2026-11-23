import { copyFile, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { documents, platforms, repository, version } from "./site-data.js";

const root = resolve(import.meta.dir, "../..");
const source = import.meta.dir;
const output = resolve(process.argv[2] ?? join(root, "dist-landing"));
const base = "/vyline/";
const github = `${repository}/blob/main/`;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return !path || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};
await mkdir(output, { recursive: true });
const realOutput = await realpath(output);
const realRoot = await realpath(root);
if (
  inside(realOutput, realRoot) ||
  ["Vyline", "docs", "scripts", "logo", ".github"].some((path) =>
    inside(join(realRoot, path), realOutput),
  )
)
  throw new Error("Refusing to build into source directories");
if ((await readdir(output)).length && !(await Bun.file(join(output, ".vyline-site")).exists()))
  throw new Error("Refusing to overwrite an unmanaged directory");
await mkdir(join(output, "assets"), { recursive: true });
await writeFile(join(output, ".vyline-site"), "Vyline documentation build\n");
for (const name of ["site.css", "site.js", "search-text.js"])
  await copyFile(join(source, name), join(output, "assets", name));
await copyFile(join(root, "logo/assets/mono/original.svg"), join(output, "assets/logo.svg"));
await copyFile(join(root, "logo/LICENCE"), join(output, "assets/LOGO-LICENCE.txt"));
await writeFile(join(output, ".nojekyll"), "");

const urlFor = (path: string) =>
  path === "links/README.md" ? `${base}links/` : `${base}guide/${path.replace(/\.md$/, ".html")}`;
const sectionFor = (path: string, category: string) =>
  path === "docs/start-here.md" || path.includes("/install/")
    ? "install"
    : category === "開発"
      ? "wiki"
      : "docs";
const metadata = await Promise.all(
  documents.map(async ([path, category, title, summary]) => ({
    path,
    category,
    title,
    summary,
    section: sectionFor(path, category),
    url: urlFor(path),
    markdown: await readFile(join(root, path), "utf8"),
  })),
);
type Doc = (typeof metadata)[number];
const published = new Map(metadata.map((doc) => [doc.path, doc.url]));
const doc = (path: string) => metadata.find((item) => item.path === path)!;
const slug = (text: string) =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
    .trim()
    .replace(/\s/g, "-");
const icons: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10H15v-7H9v7H3z"/>',
  install: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  docs: '<path d="M12 5v16M3 4c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 2-3-3-6-3-9-2z"/>',
  wiki: '<rect x="8" y="3" width="8" height="6" rx="1"/><rect x="2" y="16" width="8" height="5" rx="1"/><rect x="14" y="16" width="8" height="5" rx="1"/><path d="M12 9v4M6 16v-3h12v3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
};
const icon = (name: string) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.docs}</svg>`;
const sectionNames: Record<string, string> = {
  home: "ホーム",
  install: "導入・インストール",
  docs: "ガイド",
  wiki: "技術 Wiki",
  blog: "更新情報",
  status: "対応状況",
};
const sectionUrl = (section: string) => (section === "home" ? base : `${base}${section}/`);
function navigation(active: string, current?: Doc) {
  const top = ["home", "install", "docs", "wiki"]
    .map(
      (section) =>
        `<a class="nav-primary${active === section ? " selected" : ""}" href="${sectionUrl(section)}"${active === section && !current ? ' aria-current="page"' : ""}>${icon(section)}${sectionNames[section]}</a>`,
    )
    .join("");
  const groups = [
    ["使い始める", metadata.filter((item) => item.section === "install")],
    ["使いこなす", metadata.filter((item) => item.section === "docs")],
    ["仕組みと開発", metadata.filter((item) => item.section === "wiki")],
  ] as const;
  return `<nav aria-label="ドキュメント"><div class="primary-nav">${top}</div>${groups.map(([name, items]) => `<div class="nav-group"><p>${name}</p>${items.map((item) => `<a href="${item.url}"${item.path === current?.path ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a>`).join("")}</div>`).join("")}<div class="nav-group"><p>プロジェクト</p><a href="${base}status/">対応状況</a><a href="${base}blog/">更新情報</a><a href="${repository}">GitHub ${icon("external")}</a></div></nav>`;
}
function shell(
  title: string,
  summary: string,
  active: string,
  content: string,
  options: { current?: Doc; toc?: string; wide?: boolean } = {},
) {
  const nav = navigation(active, options.current);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(summary)}"><meta name="theme-color" content="#ffffff"><title>${escapeHtml(title)} | Vyline</title><link rel="icon" href="${base}assets/logo.svg"><link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script></head><body><a class="skip-link" href="#main">本文へ移動</a><header class="topbar"><a class="brand" href="${base}" aria-label="Vyline ホーム"><img src="${base}assets/logo.svg" width="40" height="40" alt=""><span>Vyline<span class="brand-sub">ドキュメント</span></span></a><button class="search-trigger" data-open-search aria-label="ドキュメントを検索">${icon("search")}<span>ドキュメントを検索</span><kbd>Ctrl K</kbd></button><div class="header-links"><a href="${base}status/" class="version">v${version}</a><a href="${repository}">GitHub ${icon("external")}</a></div></header><details class="mobile-nav"><summary>ドキュメントメニュー <span aria-hidden="true">＋</span></summary>${nav}</details><aside class="sidebar">${nav}<div class="sidebar-foot">Project Vyline<br><span>非公式 LINE クライアント</span></div></aside><div class="workspace${options.wide ? " wide" : ""}"><div class="content-layout${options.toc ? " with-toc" : ""}"><main id="main" tabindex="-1">${options.toc ? `<details class="mobile-toc"><summary>このページの内容</summary>${options.toc}</details>` : ""}${content}</main>${options.toc ? `<aside class="toc"><p>このページの内容</p>${options.toc}</aside>` : ""}</div><footer><span>Software © Project Vyline / MIT</span><span>Logo © 2026 y2mc / <a href="${base}assets/LOGO-LICENCE.txt">CC BY 4.0</a></span></footer></div><dialog class="search-dialog" aria-labelledby="search-title"><form method="dialog" class="search-dialog-head"><label id="search-title" class="visually-hidden" for="global-search">ドキュメントを検索</label>${icon("search")}<input id="global-search" type="search" placeholder="キーワードを入力…" autocomplete="off"><button class="search-close" aria-label="検索を閉じる">Esc</button></form><div class="search-filters" aria-label="検索する範囲"><button data-scope="all" aria-pressed="true">すべて</button><button data-scope="install" aria-pressed="false">導入</button><button data-scope="docs" aria-pressed="false">ガイド</button><button data-scope="wiki" aria-pressed="false">Wiki</button></div><p class="search-count" role="status"></p><div class="search-results"></div><div class="search-dialog-foot">↑ ↓ で選ぶ <span>Enter で開く</span></div></dialog><div class="toast" role="status"></div><noscript><p class="noscript-notice">検索にはJavaScriptが必要です。<a href="${base}docs/">ガイド一覧</a>と<a href="${base}wiki/">Wiki一覧</a>から記事を選べます。</p></noscript></body></html>`;
}
async function page(path: string, html: string) {
  const destination = join(output, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, html);
}
const crumbs = (section: string, label?: string) =>
  `<nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span>${label ? `<a href="${sectionUrl(section)}">${sectionNames[section]}</a><span>/</span><span>${escapeHtml(label)}</span>` : `<span>${sectionNames[section]}</span>`}</nav>`;
const entry = (item: Doc) =>
  `<a class="entry" href="${item.url}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.summary)}</small></span>${icon("chevron")}</a>`;
const entries = (paths: string[]) => paths.map((path) => entry(doc(path))).join("");
const heading = (title: string, lead: string) =>
  `<header class="page-heading"><h1>${title}</h1><p>${lead}</p></header>`;
const platformLinks = Object.entries(platforms)
  .map(
    ([key, item]) =>
      `<a href="${base}install/#${key}">${escapeHtml(item.name)}${icon("chevron")}</a>`,
  )
  .join("");
const home = (await readFile(join(source, "index.html"), "utf8"))
  .replaceAll("{{BASE}}", base)
  .replaceAll("{{VERSION}}", version)
  .replace("{{PLATFORMS}}", platformLinks)
  .replace(
    "{{GUIDES}}",
    entries([
      "docs/features.md",
      "docs/user-guide/vyline-backup-restore.md",
      "docs/user-guide/themes.md",
      "docs/user-guide/error-handling.md",
    ]),
  )
  .replace(
    "{{WIKI}}",
    entries([
      "docs/architecture.md",
      "docs/developers/index.md",
      "docs/api/openapi.md",
      "links/README.md",
    ]),
  );
await page(
  "index.html",
  shell("ドキュメント", "Vylineの導入、使い方、技術Wikiをまとめたドキュメント。", "home", home, {
    wide: true,
  }),
);

const installSteps = `<section class="first-login" id="first-login"><h2>インストールのあとは</h2><ol class="steps"><li><span>1</span><div><h3>Vyline を起動する</h3><p>ローカルアプリ、またはブラウザでVylineの画面を開きます。</p></div></li><li><span>2</span><div><h3>スマホの LINE でログインを承認</h3><p>QRコードを読み取り、スマホで承認します。確認番号が出たら画面の案内に従ってください。</p></div></li><li><span>3</span><div><h3>最初の設定を選ぶ</h3><p>Vyline Setupで使い方を選択。テーマや通知は、あとから設定で変更できます。</p></div></li></ol><a class="text-link" href="${urlFor("docs/start-here.md")}">ログインと初回設定を読む</a></section>`;
const panels = Object.entries(platforms)
  .map(
    ([key, item]) =>
      `<section class="platform-panel" id="${key}" aria-labelledby="title-${key}"><div class="platform-heading"><div><span class="platform-detail">${escapeHtml(item.detail)}</span><h2 id="title-${key}">${escapeHtml(item.name)}</h2></div>${item.file ? `<a class="button primary" href="${repository}/releases/download/v${version}/${item.file}">${icon("install")}${escapeHtml(item.label)}</a>` : ""}</div><p>${escapeHtml(item.description)}</p>${key === "macos" ? `<p class="alternate-download"><a href="${repository}/releases/download/v${version}/Vyline-macos-arm64-${version}.zip">Apple Silicon (arm64)</a><a href="${repository}/releases/download/v${version}/Vyline-macos-x64-${version}.zip">Intel (x64)</a></p>` : ""}${item.command ? codeBlock(item.command, "sh") : ""}<p class="platform-note">${escapeHtml(item.note)}</p><a class="text-link" href="${urlFor(`docs/install/${item.guide}.md`)}">${escapeHtml(item.name)} の詳しい導入手順 ${icon("chevron")}</a></section>`,
  )
  .join("");
await page(
  "install/index.html",
  shell(
    "導入・インストール",
    "使う環境に合うVylineの起動方法を選び、ログインと初回設定を進めます。",
    "install",
    `${crumbs("install")}${heading("Vyline をはじめる", `使う環境に合わせて、起動方法を選んでください。<br>現在の安定版は v${version} です。`)}<div class="notice">Vyline は LINE の非公式クライアントです。使い始める前に、<a href="${urlFor("docs/user-guide/privacy-and-data.md")}">保存されるデータとプライバシー</a>を確認してください。</div><div class="platform-tabs" aria-label="起動する環境">${Object.entries(
      platforms,
    )
      .map(
        ([key, item], index) =>
          `<a href="#${key}" data-platform="${key}"${index === 0 ? ' aria-current="true"' : ""}>${escapeHtml(item.name)}</a>`,
      )
      .join("")}</div><div class="platform-panels">${panels}</div>${installSteps}`,
    {
      toc: `<a href="#bun">環境を選ぶ</a><a href="#first-login">ログインと初回設定</a><a href="${urlFor("docs/user-guide/error-handling.md")}">起動に困ったとき</a>`,
    },
  ),
);

for (const section of ["docs", "wiki"]) {
  const items = metadata.filter((item) => item.section === section);
  const groups = [...new Set(items.map((item) => item.category))];
  const isWiki = section === "wiki";
  const groupsHtml = groups
    .map(
      (category) =>
        `<section class="doc-group"><h2>${isWiki ? "技術資料" : escapeHtml(category)}</h2><div class="entry-list">${items
          .filter((item) => item.category === category)
          .map(entry)
          .join("")}</div></section>`,
    )
    .join("");
  const map = `<section class="system-map" aria-labelledby="system-map-heading"><div class="section-heading"><h2 id="system-map-heading">コードの全体像</h2><a href="${urlFor("docs/architecture.md")}">構成を詳しく読む</a></div><div class="system-flow"><a href="${urlFor("docs/architecture.md")}#全体構成"><span>画面と操作</span><strong>React + Vite</strong><code>apps/desktop</code></a><span class="system-connector">HTTP<br>↔</span><a href="${urlFor("docs/architecture.md")}#レイヤー責務"><span>API とデータ管理</span><strong>Hono + Bun</strong><code>backend</code></a><span class="system-connector">RPC<br>↔</span><a href="${urlFor("docs/architecture.md")}#protocol-直接-import"><span>LINE との通信</span><strong>@vyline/protocol</strong><code>packages/protocol</code></a></div><p>画面からAPI、プロトコルへ。各レイヤーの役割と接点を辿れます。</p></section>`;
  await page(
    `${section}/index.html`,
    shell(
      sectionNames[section],
      isWiki
        ? "Vylineのアーキテクチャ、プロトコル、API、開発環境の技術資料。"
        : "目的からVylineの使い方を探せます。",
      section,
      `${crumbs(section)}${heading(isWiki ? "技術 Wiki" : "使い方ガイド", isWiki ? "Vyline の仕組みを読み解くための技術資料。<br>設計を理解し、コードを調べ、開発に参加する。" : "やりたいことから、必要な手順へ。<br>日々の操作から、大切なデータの管理まで。")}${isWiki ? map : `<div class="guide-start"><span>${icon("install")}</span><div><h2>初めて使いますか？</h2><p>環境を選んで、インストールと初回ログインへ。</p></div><a class="button" href="${base}install/">導入ガイドを開く</a></div>`}${groupsHtml}`,
      { wide: true },
    ),
  );
}

function sourceLink(sourcePath: string, href: string) {
  if (href.startsWith(base)) {
    return href === `${base}#start` || href === `${base}#tour` ? `${base}install/` : href;
  }
  if (href.startsWith("https://nezumi0627.github.io/vyline/")) {
    const suffix = href.slice("https://nezumi0627.github.io/vyline/".length);
    return /^#(?:start|tour)/.test(suffix) ? `${base}install/` : base + suffix;
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) || href.startsWith("#")) return href;
  const [, file, fragment = ""] = href.match(/^([^?#]*)([?#].*)?$/)!;
  if (!file) return href;
  let decoded: string;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    return href;
  }
  const target = relative(root, resolve(dirname(join(root, sourcePath)), decoded))
    .split(sep)
    .join("/");
  return target.startsWith("../") ? href : (published.get(target) ?? github + target) + fragment;
}
function highlight(text: string) {
  return [
    ...text.matchAll(
      /(#[^\n]*|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'[^']*'|\b(?:const|let|return|import|from|export|async|await|function|if|throw|new|true|false|null)\b|--[\w-]+)|([\s\S])/g,
    ),
  ]
    .map((match) => {
      if (!match[1]) return escapeHtml(match[2]);
      const token = match[1];
      const kind =
        token.startsWith("#") || token.startsWith("//")
          ? "comment"
          : /^["']/.test(token)
            ? "string"
            : token.startsWith("--")
              ? "flag"
              : "keyword";
      return `<span class="token-${kind}">${escapeHtml(token)}</span>`;
    })
    .join("");
}
function codeBlock(text: string, language = "text") {
  return `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(language)}</span><button class="copy-code" aria-label="コードをコピー">コピー</button></div><pre><code class="language-${escapeHtml(language)}">${highlight(text)}</code></pre></div>`;
}
function renderMarkdown(markdown: string, sourcePath: string) {
  const headings: { id: string; title: string }[] = [];
  const ids = new Map<string, number>();
  const decode = (text: string) =>
    text.replace(
      /&(?:amp|lt|gt|quot|#39);/g,
      (entity) =>
        ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]!,
    );
  let html = Bun.markdown
    .html(markdown)
    .replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, level, title) => {
      const plain = decode(title.replace(/<[^>]*>/g, ""));
      const key = slug(plain);
      const count = ids.get(key) ?? 0;
      ids.set(key, count + 1);
      const id = `${key}${count ? `-${count}` : ""}`;
      if (level === "2") headings.push({ id, title: plain });
      return `<h${level} id="${escapeHtml(id)}">${title}</h${level}>`;
    });
  html = html.replace(/(href|src)="([^"]*)"/g, (_, attribute, href) => {
    let linked = sourceLink(sourcePath, decode(href));
    if (attribute === "src" && linked.startsWith(github))
      linked = linked.replace(github, "https://raw.githubusercontent.com/nezumi0627/vyline/main/");
    return `${attribute}="${escapeHtml(linked)}"`;
  });
  html = html.replace(
    /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_, language, code) => codeBlock(decode(code).replace(/\n$/, ""), language),
  );
  html = html
    .replace(
      /<table>/g,
      '<div class="table-scroll" tabindex="0" role="region" aria-label="表を横スクロール"><table>',
    )
    .replace(/<\/table>/g, "</table></div>");
  return {
    html,
    toc: headings
      .map(({ id, title }) => `<a href="#${escapeHtml(id)}">${escapeHtml(title)}</a>`)
      .join(""),
  };
}
for (const item of metadata) {
  const { html, toc } = renderMarkdown(item.markdown, item.path);
  const siblings = metadata.filter((other) => other.section === item.section);
  const index = siblings.indexOf(item);
  const previous = siblings[index - 1];
  const next = siblings[index + 1];
  const pagination = `<nav class="pagination" aria-label="前後のページ">${previous ? `<a href="${previous.url}"><small>前のページ</small><strong>${escapeHtml(previous.title)}</strong></a>` : "<span></span>"}${next ? `<a href="${next.url}"><small>次のページ</small><strong>${escapeHtml(next.title)}</strong></a>` : ""}</nav>`;
  const content = `${crumbs(item.section, item.title)}<div class="article-label">${sectionNames[item.section]}<span>${escapeHtml(item.category)}</span></div><article class="prose">${html}</article><div class="article-source"><a href="${github + item.path}">${icon("code")}GitHub で原文を読む</a><span>内容の修正・提案は GitHub へ</span></div>${pagination}`;
  await page(
    item.path === "links/README.md"
      ? "links/index.html"
      : `guide/${item.path.replace(/\.md$/, ".html")}`,
    shell(item.title, item.summary, item.section, content, { current: item, toc }),
  );
}
const status = renderMarkdown(
  await readFile(join(root, "docs/feature-capabilities.md"), "utf8"),
  "docs/feature-capabilities.md",
);
await page(
  "status/index.html",
  shell(
    "対応状況",
    "機能ごとの実装と実LINE環境での検証状況。",
    "status",
    `${crumbs("status")}<article class="prose">${status.html}</article>`,
    { toc: status.toc },
  ),
);
const posts = [];
for (const file of await readdir(join(source, "blog"))) {
  if (!file.endsWith(".md") || file.startsWith("_") || file === "README.md") continue;
  const path = `Vyline/website/blog/${file}`;
  const match = (await readFile(join(root, path), "utf8")).match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/,
  );
  if (!match) throw new Error(`Missing blog frontmatter: ${file}`);
  const value = (key: string) =>
    (match[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "")
      .replace(/^["']|["']$/g, "")
      .trim();
  if (value("published") !== "true") continue;
  const title = value("title");
  const summary = value("summary");
  const name = file.replace(/\.md$/, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name === "index")
    throw new Error(`Invalid blog filename: ${file}`);
  const rendered = renderMarkdown(match[2], path);
  const url = `${base}blog/${name}/`;
  posts.push({ title, summary, date: value("date"), url });
  await page(
    `blog/${name}/index.html`,
    shell(
      title,
      summary,
      "blog",
      `${crumbs("blog")}<header class="page-heading"><p class="article-date">${escapeHtml(value("date"))}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p></header><article class="prose">${rendered.html}</article>`,
      { toc: rendered.toc },
    ),
  );
}
posts.sort((a, b) => b.date.localeCompare(a.date));
await page(
  "blog/index.html",
  shell(
    "更新情報",
    "Vylineのリリースとプロジェクトからのお知らせ。",
    "blog",
    `${crumbs("blog")}${heading("更新情報", "リリースと、プロジェクトからのお知らせ。")}${posts.map((post) => `<a class="blog-entry" href="${post.url}"><time>${escapeHtml(post.date)}</time><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(post.summary)}</p></a>`).join("")}<p class="muted">最新の配布版とすべての変更履歴は <a href="${repository}/releases">GitHub Releases</a> で確認できます。</p><p><a class="text-link" href="${base}blog/write/">ブログの書き方を見る ${icon("chevron")}</a></p>`,
    { wide: true },
  ),
);
const writing = renderMarkdown(
  await readFile(join(source, "blog/README.md"), "utf8"),
  "Vyline/website/blog/README.md",
);
await page(
  "blog/write/index.html",
  shell(
    "ブログの書き方",
    "Vylineのブログ記事を追加する手順。",
    "blog",
    `<article class="prose">${writing.html}</article>`,
    { toc: writing.toc },
  ),
);
await writeFile(
  join(output, "search.json"),
  JSON.stringify(
    metadata.map(({ markdown, ...item }) => ({
      ...item,
      content: markdown
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<[^>]*>/g, " ")
        .replace(/[`#*|]/g, " ")
        .replace(/\s+/g, " "),
    })),
  ),
);
console.log(
  `Built Vyline knowledge site: ${metadata.length} articles, installation, guides, Wiki, status and blog in ${output}`,
);
