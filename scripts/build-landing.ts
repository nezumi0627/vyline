import { copyFile, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  documents,
  docGroups,
  sectionFor,
  version,
  release,
  platforms,
} from "../Vyline/website/site-data.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "Vyline/website");
const output = resolve(process.argv[2] ?? join(root, "dist-landing"));
const base = "/vyline/";
const github = "https://github.com/nezumi0627/vyline/blob/main/";
const repositoryMapSource = "links/README.md";
const blogDirectory = join(source, "blog");
const capabilitySource = "docs/feature-capabilities.md";
const blogBase = `${base}blog/`;
const statusUrl = `${base}status/`;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
const forward = (path: string) => path.split(sep).join("/");
const docUrl = (path: string) =>
  path === repositoryMapSource ? `${base}links/` : `${base}guide/${path.replace(/\.md$/, ".html")}`;
const published = new Set(documents.map(([path]) => path));

// Never clear a destination. Refuse existing source/unmanaged directories,
// including symlinks to them, before writing any generated files.
await mkdir(output, { recursive: true });
const realOutput = await realpath(output);
const realRoot = await realpath(root);
const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};
if (
  inside(realOutput, realRoot) ||
  ["docs", "Vyline", "scripts", ".github", "logo"].some((path) =>
    inside(join(realRoot, path), realOutput),
  )
) {
  throw new Error("Refusing to write website output into source directories");
}
const entries = await readdir(output);
if (entries.length && !(await Bun.file(join(output, ".vyline-site")).exists())) {
  throw new Error("Refusing to overwrite a nonempty, unmanaged directory");
}

const metadata = await Promise.all(
  documents.map(async ([path, category, title, summary]) => {
    const markdown = await readFile(join(root, path), "utf8");
    const content = Bun.markdown
      .html(markdown)
      .replace(/<[^>]*>/g, " ")
      .replace(
        /&(?:amp|lt|gt|quot|#39);/g,
        (entity) =>
          ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]!,
      )
      .replace(/\s+/g, " ")
      .trim();
    return {
      path,
      category,
      title,
      summary,
      markdown,
      content,
      section: sectionFor(path),
      url: docUrl(path),
    };
  }),
);
await mkdir(join(output, "assets"), { recursive: true });
await writeFile(join(output, ".vyline-site"), "Vyline documentation build\n");
for (const name of ["site.css", "site.js", "site-data.js", "navigation.js"])
  await copyFile(join(source, name), join(output, "assets", name));
await copyFile(join(root, "logo/assets/mono/original.svg"), join(output, "assets/logo.svg"));
await copyFile(join(root, "logo/LICENCE"), join(output, "assets/LOGO-LICENCE.txt"));
await writeFile(join(output, ".nojekyll"), "");
await writeFile(
  join(output, "search.json"),
  JSON.stringify(metadata.map(({ markdown, ...doc }) => doc)),
);

function row(doc: (typeof metadata)[number]) {
  const terms = `${doc.title} ${doc.summary} ${doc.category} ${doc.content}`;
  const prefixLength = `${doc.title} ${doc.summary} ${doc.category} `.length;
  return `<a class="document-row" href="${doc.url}" data-category="${escapeHtml(doc.category)}" data-content-offset="${prefixLength}" data-search="${escapeHtml(terms)}"><span><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.summary)}</small><small class="search-match"></small></span><span aria-hidden="true">→</span></a>`;
}

function sourceLink(path: string, sourceHref: string) {
  // Same-site links in Markdown must stay in the local preview as well as Pages.
  const publicBase = "https://nezumi0627.github.io/vyline/";
  const href = sourceHref.startsWith(publicBase)
    ? base + sourceHref.slice(publicBase.length)
    : sourceHref;
  if (href === `${base}#start` || href === `${base}#install`) return `${base}install/`;
  if (href === `${base}#docs`) return `${base}docs/`;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return href;
  const match = href.match(/^([^?#]*)([?#].*)?$/)!;
  if (!match[1]) return href;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return href;
  }
  const target = forward(relative(root, resolve(dirname(join(root, path)), decoded)));
  if (target.startsWith("../")) return href;
  if (postUrls.has(target)) return postUrls.get(target)!;
  return `${published.has(target) ? docUrl(target) : github + target}${match[2] ?? ""}`;
}
function slug(text: string) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

function renderMarkdown(markdown: string, sourcePath: string) {
  const headings: Array<{ title: string; id: string }> = [];
  const ids = new Map<string, number>();
  let html = Bun.markdown.html(markdown);
  html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, level, title) => {
    const plainTitle = title.replace(/<[^>]*>/g, "");
    const key = slug(plainTitle);
    const count = ids.get(key) ?? 0;
    ids.set(key, count + 1);
    const id = `${key}${count ? `-${count}` : ""}`;
    if (level === "2") headings.push({ title: plainTitle, id });
    return `<h${level} id="${escapeHtml(id)}">${title}</h${level}>`;
  });
  html = html
    .replace(/(href|src)="([^"]*)"/g, (_, attribute, href) => {
      const linked = sourceLink(sourcePath, href.replaceAll("&amp;", "&"));
      const url =
        attribute === "src" && linked.startsWith(github)
          ? linked.replace(github, "https://raw.githubusercontent.com/nezumi0627/vyline/main/")
          : linked;
      return `${attribute}="${escapeHtml(url)}"`;
    })
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>");
  return { html, headings };
}

function readFrontmatter(sourcePath: string, markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`Blog post must start with YAML frontmatter: ${sourcePath}`);
  const values = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z]+):\s*(.*)$/);
    if (field) values.set(field[1], field[2].trim());
  }
  const value = (key: string) =>
    (values.get(key) ?? "").replace(
      /^(?:"([\s\S]*)"|'([\s\S]*)')$/,
      (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted,
    );
  const title = value("title");
  const summary = value("summary");
  const date = value("date");
  const category = value("category");
  const published = value("published");
  const tagsValue = value("tags").replace(/^\[/, "").replace(/\]$/, "");
  const tags = tagsValue
    .split(",")
    .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  if (
    !title ||
    !summary ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !category ||
    !["true", "false"].includes(published)
  ) {
    throw new Error(
      `Blog post frontmatter requires title, summary, date, category, and published: ${sourcePath}`,
    );
  }
  const slugName = sourcePath.split(/[\\/]/).at(-1)!.replace(/\.md$/, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugName) || slugName === "index") {
    throw new Error(`Blog filename must be a lowercase hyphenated slug: ${sourcePath}`);
  }
  return {
    slug: slugName,
    title,
    summary,
    date,
    category,
    tags,
    published: published === "true",
    markdown: match[2].trim(),
    sourcePath,
  };
}

const blogFiles = (await readdir(blogDirectory)).filter(
  (file) => file.endsWith(".md") && file !== "README.md" && !file.startsWith("_"),
);
const allPosts = (
  await Promise.all(
    blogFiles.map(async (file) => {
      const sourcePath = `Vyline/website/blog/${file}`;
      return readFrontmatter(sourcePath, await readFile(join(blogDirectory, file), "utf8"));
    }),
  )
).sort((a, b) => b.date.localeCompare(a.date));
const posts = allPosts.filter((post) => post.published);
const postUrls = new Map(posts.map((post) => [post.sourcePath, `${blogBase}${post.slug}/`]));

const siteHeader = (active = "") => `<header class="site-header">
  <a class="brand" href="${base}" aria-label="Vyline ホーム"><img src="${base}assets/logo.svg" width="24" height="24" alt=""><span>Vyline</span></a>
  <nav class="header-links" aria-label="メインナビゲーション"><a href="${base}install/"${active === "install" ? ' aria-current="page"' : ""}>導入・インストール</a><a href="${base}docs/"${active === "docs" ? ' aria-current="page"' : ""}>Docs</a></nav>
  <div class="header-actions"><button class="header-search" type="button" data-open-search aria-haspopup="dialog">資料を検索 <kbd>/</kbd></button><a href="https://github.com/nezumi0627/vyline">GitHub ↗</a></div>
</header>`;
const commonFooter = `<footer class="site-footer"><div><p>Software © Project Vyline / MIT · Logo © 2026 y2mc / <a href="${base}assets/LOGO-LICENCE.txt">CC BY 4.0</a></p><nav aria-label="フッターナビゲーション"><a href="${blogBase}">ブログ</a><a href="${statusUrl}">対応状況</a><a href="${base}links/">関連リポジトリ</a></nav></div></footer>`;

const sitePage = (title: string, summary: string, body: string, section = "") => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#101012"><meta name="description" content="${escapeHtml(summary)}">
<title>${escapeHtml(title)} | Vyline</title><link rel="icon" href="${base}assets/logo.svg">
<link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script>
</head><body data-section="${section}"><a class="skip-link" href="#main">本文へ移動</a>
${siteHeader(section)}${body}${commonFooter}</body></html>`;
const pageStart = (title: string, summary: string, extraClass: string, main: string) =>
  sitePage(title, summary, `<main id="main" class="${extraClass}">${main}</main>`);

const home = (await readFile(join(source, "index.html"), "utf8"))
  .replaceAll("{{BASE}}", base)
  .replace("{{HEADER}}", siteHeader())
  .replace("{{FOOTER}}", commonFooter)
  .replaceAll("{{VERSION}}", version)
  .replace("{{RELEASE}}", release);
await writeFile(join(output, "index.html"), home);

const blogRows = posts
  .map(
    (post, index) =>
      `<li><a class="journal-row" href="${blogBase}${post.slug}/"><span class="journal-date">${escapeHtml(post.date.replaceAll("-", "."))}</span><span class="journal-copy"><span class="journal-category">${escapeHtml(post.category)}</span><strong>${escapeHtml(post.title)}</strong><small>${escapeHtml(post.summary)}</small><span class="journal-tags">${post.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</span></span><span class="journal-number">${String(index + 1).padStart(2, "0")}</span></a></li>`,
  )
  .join("");
const blogIntro = `<div class="journal-head"><h1>ブログ</h1><p class="journal-lead">Vylineの開発ノートとリリース記事。</p><p class="journal-authoring">記事はMarkdownで追加できます。<a href="${blogBase}write/">書き方を見る ↗</a></p></div>`;
const blogIndex = `<div class="journal-layout wrap">${blogIntro}<section class="journal-feed" aria-labelledby="journal-feed-title"><div class="journal-feed-heading"><h2 id="journal-feed-title">記事</h2><span>${String(posts.length).padStart(2, "0")} POSTS</span></div>${posts.length ? `<ol class="journal-list">${blogRows}</ol>` : `<p class="journal-empty">記事はまだありません。最初の記事をMarkdownで追加できます。</p>`}</section><aside class="journal-side"><p>NOW</p><strong>Vyline ${version}</strong><span>開発ノートとリリースの記録</span><a href="${statusUrl}">機能の対応状況を見る ↗</a></aside></div>`;
await mkdir(join(output, "blog"), { recursive: true });
await writeFile(
  join(output, "blog", "index.html"),
  pageStart("ブログ", "Vylineの開発ノートとリリース記事", "journal-page", blogIndex),
);
const authorGuidePath = "Vyline/website/blog/README.md";
const authorGuideSource = await readFile(join(root, authorGuidePath), "utf8");
const { html: authorGuideHtml } = renderMarkdown(authorGuideSource, authorGuidePath);
const authorGuide = `<div class="journal-article-layout wrap"><article class="journal-article"><nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span><a href="${blogBase}">ブログ</a><span>/</span><span>記事の書き方</span></nav><header class="journal-article-head"><p class="journal-coordinate">VYLINE / WRITING</p><h1>記事の書き方</h1><p class="journal-lead">Markdownを追加すると、記事一覧とページが自動で生成されます。</p></header><div class="journal-prose">${authorGuideHtml}</div><div class="journal-article-end"><a href="https://github.com/nezumi0627/vyline/tree/main/Vyline/website/blog">記事フォルダーを開く ↗</a><a href="${blogBase}">ブログ一覧へ戻る</a></div></article></div>`;
await mkdir(join(output, "blog", "write"), { recursive: true });
await writeFile(
  join(output, "blog", "write", "index.html"),
  pageStart(
    "記事の書き方",
    "VylineブログにMarkdownで記事を追加する",
    "journal-article-page",
    authorGuide,
  ),
);

for (let index = 0; index < posts.length; index++) {
  const post = posts[index];
  const { html, headings } = renderMarkdown(post.markdown, post.sourcePath);
  const toc = headings
    .map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`)
    .join("");
  const previous = posts[index - 1];
  const next = posts[index + 1];
  const articleContent = `<div class="journal-article-layout wrap"><article class="journal-article"><nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span><a href="${blogBase}">ブログ</a><span>/</span><span>${escapeHtml(post.category)}</span></nav><header class="journal-article-head"><p class="journal-coordinate">${escapeHtml(post.date.replaceAll("-", "."))} <span>/</span> ${escapeHtml(post.category)}</p><h1>${escapeHtml(post.title)}</h1><p class="journal-lead">${escapeHtml(post.summary)}</p><div class="journal-byline"><span>Project Vyline</span>${post.tags.map((tag) => `<span class="journal-tag">${escapeHtml(tag)}</span>`).join("")}</div></header><div class="journal-prose">${html}</div><div class="journal-article-end"><a href="${github + post.sourcePath}">Markdown原文を見る ↗</a><a href="${blogBase}">記事一覧へ戻る</a></div><nav class="journal-pager" aria-label="記事移動">${previous ? `<a href="${blogBase}${previous.slug}/"><small>前の記事</small>${escapeHtml(previous.title)} →</a>` : "<span></span>"}${next ? `<a href="${blogBase}${next.slug}/"><small>次の記事</small>← ${escapeHtml(next.title)}</a>` : "<span></span>"}</nav></article><aside class="journal-toc" aria-label="この記事の目次"><h2>この記事で</h2>${toc || `<a href="#main">本文</a>`}<a class="toc-status-link" href="${statusUrl}">対応状況 ↗</a></aside></div>`;
  await mkdir(join(output, "blog", post.slug), { recursive: true });
  await writeFile(
    join(output, "blog", post.slug, "index.html"),
    pageStart(post.title, post.summary, "journal-article-page", articleContent),
  );
}

const capabilityMarkdown = await readFile(join(root, capabilitySource), "utf8");
const matrixSection = capabilityMarkdown.split(/^## Matrix\s*$/m)[1]?.split(/^## /m)[0] ?? "";
const matrixLines = matrixSection.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
if (matrixLines.length < 3)
  throw new Error(`Could not read capability table from ${capabilitySource}`);
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
const headers = cells(matrixLines[0]);
const column = (name: string) => {
  const index = headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
  if (index < 0) throw new Error(`Missing '${name}' column in ${capabilitySource}`);
  return index;
};
const capabilityRows = matrixLines.slice(2).map(cells);
const statusLabels: Record<string, string> = {
  verified: "確認済み",
  partial: "一部確認",
  unverified: "未検証",
  unsupported: "未対応",
};
const capabilityStatus = column("status");
const statusCounts = Object.fromEntries(
  Object.keys(statusLabels).map((status) => [
    status,
    capabilityRows.filter((row) => row[capabilityStatus] === status).length,
  ]),
);
const statusRows = capabilityRows
  .map((row) => {
    const status = row[capabilityStatus];
    const label = statusLabels[status] ?? "要確認";
    return `<tr><th scope="row"><strong>${escapeHtml(row[column("Capability")])}</strong><small>${escapeHtml(row[column("user behavior")])}</small></th><td><span class="capability-label capability-${escapeHtml(status)}">${escapeHtml(label)}</span></td><td>${escapeHtml(row[column("verification")].replace(/`/g, ""))}</td><td>${escapeHtml(row[column("missing link / limitation")].replace(/`/g, ""))}</td></tr>`;
  })
  .join("");
const updated = capabilityMarkdown.match(/^最終更新:\s*(.+)$/m)?.[1] ?? "日付未記載";
const statusMain = `<div class="status-layout wrap"><header class="status-head"><p class="journal-coordinate">VYLINE / CAPABILITIES</p><h1>機能の現在地を、<br>根拠とともに。</h1><p class="journal-lead">機能ごとの実装状況と、確認できた範囲を公開しています。コードがあることと、実環境で確かめられたことを分けて記録します。</p><p class="status-updated">資料更新 ${escapeHtml(updated)} <span>·</span> <a href="${base}guide/docs/feature-capabilities.html">検証資料を読む ↗</a></p></header><div class="status-counts" aria-label="対応状況の件数"><div><strong>${statusCounts.verified}</strong><span>確認済み</span></div><div><strong>${statusCounts.partial}</strong><span>一部確認</span></div><div><strong>${statusCounts.unverified}</strong><span>未検証</span></div><div><strong>${statusCounts.unsupported}</strong><span>未対応</span></div></div><div class="status-note"><p><strong>「一部確認」は未実装という意味ではありません。</strong> 実装を確認できても、LINEの実アカウントを使った動作確認などが残っている場合は、その範囲を明記しています。</p><a href="${base}guide/docs/feature-capabilities.html">判定方法と各機能の詳細 ↗</a></div><div class="capability-table-wrap"><table class="capability-table"><thead><tr><th scope="col">機能</th><th scope="col">状況</th><th scope="col">確認できたこと</th><th scope="col">残っている確認</th></tr></thead><tbody>${statusRows}</tbody></table></div></div>`;
await mkdir(join(output, "status"), { recursive: true });
await writeFile(
  join(output, "status", "index.html"),
  pageStart("対応状況", "Vylineの機能実装と検証の進捗", "status-page", statusMain),
);

type Section = "install" | "docs";
const sectionTitle = (section: Section) =>
  section === "install" ? "導入・インストール" : "ドキュメント";
const groupsFor = (section: Section) =>
  section === "install"
    ? [
        ["はじめに", "はじめに"],
        ["インストール", "環境別インストール"],
      ]
    : docGroups;
const sectionDocs = (section: Section) =>
  groupsFor(section).flatMap(([category]) =>
    metadata.filter((doc) => doc.section === section && doc.category === category),
  );
const groupId = (category: string) =>
  category === "はじめに"
    ? "overview"
    : category === "インストール"
      ? "environment"
      : `group-${slug(category)}`;

function sidebar(section: Section, current = "") {
  const navigation = groupsFor(section)
    .map(
      ([category, title]) => `<details class="tree-group" open>
    <summary>${escapeHtml(title)}</summary><nav aria-label="${escapeHtml(title)}">${metadata
      .filter((doc) => doc.section === section && doc.category === category)
      .map(
        (doc) =>
          `<a href="${doc.url}"${current === doc.path ? ' aria-current="page"' : ""}>${escapeHtml(doc.title)}</a>`,
      )
      .join("")}</nav>
  </details>`,
    )
    .join("");
  return `<aside class="article-sidebar" aria-label="${sectionTitle(section)}の一覧"><details class="sidebar-panel" open><summary>${sectionTitle(section)}の一覧</summary><div class="sidebar-content">
    <p class="sidebar-title">${sectionTitle(section)}</p><span class="sidebar-version">Vyline / v${version}</span>
    <a class="sidebar-home" href="${base}${section}/"${current ? "" : ' aria-current="page"'}>概要・目次</a>${navigation}
    <div class="sidebar-crosslink"><a href="${base}${section === "install" ? "docs" : "install"}/">${section === "install" ? "技術ドキュメント" : "導入・インストール"} →</a><a href="${statusUrl}">機能の対応状況 ↗</a></div>
  </div></details></aside>`;
}

function wikiPage(
  title: string,
  summary: string,
  section: Section,
  content: string,
  headings: Array<{ title: string; id: string }>,
  path = "",
  category = "",
) {
  const toc = headings
    .map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`)
    .join("");
  const source = path ? `<a class="toc-source" href="${github + path}">Markdown原文 ↗</a>` : "";
  const mobileToc = headings.length
    ? `<details class="mobile-toc"><summary>このページの目次</summary><nav aria-label="このページの目次">${toc}</nav></details>`
    : "";
  const readingContent = content.replace(/(<\/h1>)/, `$1${mobileToc}`);
  const body = `<div class="wiki-layout">${sidebar(section, path)}
    <main id="main" class="article-content">
      <nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">Vyline</a><span aria-hidden="true">/</span><a href="${base}${section}/">${sectionTitle(section)}</a>${category ? `<span aria-hidden="true">/</span><a href="${base}${section}/#${groupId(category)}">${escapeHtml(groupsFor(section).find(([key]) => key === category)?.[1] ?? category)}</a>` : ""}${path ? `<span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(title)}</span>` : ""}</nav>
      ${path ? `<p class="page-meta">${escapeHtml(path)}</p>` : ""}
      ${readingContent}
    </main>
    <aside class="article-toc" aria-label="このページの目次"><h2>このページの目次</h2>${toc}${source}</aside>
  </div>`;
  return sitePage(title, summary, body, section);
}

const installIntroduction = `<h1>導入・インストール</h1><p class="page-summary">利用する環境を選び、インストールと初回ログインを進めます。機能や内部構成の資料は<a href="${base}docs/">ドキュメント</a>に分けています。</p>
  <section class="install-intro" id="overview"><h2>はじめに</h2><p>Vylineの概要、ログインの方法、最初の設定は「Vylineを使い始める」にまとめています。すでに環境が決まっている場合は、下のインストール手順から進めてください。</p><div class="doc-list">${row(metadata[0])}</div></section>
  <section id="environment"><h2>環境を選ぶ</h2><p>配布物のダウンロードと起動方法は、それぞれの手順で確認できます。</p><div class="table-scroll"><table class="install-table"><thead><tr><th scope="col">環境</th><th scope="col">形式</th><th scope="col">導入手順</th></tr></thead><tbody>${[
    "bun",
    "windows",
    "macos",
    "linux",
    "docker",
  ]
    .map((key) => {
      const platform = platforms[key as keyof typeof platforms];
      return `<tr><th scope="row">${platform.name}</th><td>${platform.detail.replace("おすすめ / ", "")}</td><td><a href="${base}guide/docs/install/${platform.guide}.html">手順を読む →</a></td></tr>`;
    })
    .join("")}</tbody></table></div></section>
  <section id="after-install"><h2>起動したら</h2><ol><li>インストール手順に沿ってVylineを起動します。</li><li><a href="${docUrl("docs/start-here.md")}#ログインと初回設定">ログインと初回設定</a>を確認し、アカウントのログインを進めます。</li><li>設定や機能の詳細は<a href="${base}docs/">ドキュメント</a>から探せます。</li></ol><p>エラーで進めない場合は、<a href="${docUrl("docs/user-guide/error-handling.md")}">エラーの確認と復旧</a>を参照してください。</p></section>
  <p class="notice">Vylineは非公式クライアントです。利用前に<a href="${docUrl("docs/user-guide/privacy-and-data.md")}">プライバシーとデータの扱い</a>、<a href="${statusUrl}">機能の対応状況</a>を確認してください。</p>`;
await mkdir(join(output, "install"), { recursive: true });
await writeFile(
  join(output, "install/index.html"),
  wikiPage("導入・インストール", "環境ごとの導入手順と初回起動", "install", installIntroduction, [
    { title: "はじめに", id: "overview" },
    { title: "環境を選ぶ", id: "environment" },
    { title: "起動したら", id: "after-install" },
  ]),
);

const technicalDocs = sectionDocs("docs");
const docsIntroduction = `<h1>ドキュメント</h1><p class="page-summary">Vylineの機能、データの扱い、運用、内部構成を調べるための資料です。はじめて使う場合は<a href="${base}install/">導入・インストール</a>から進めてください。</p>
  <div class="search-toolbar" id="directory-search"><label class="search-query" for="doc-query"><span class="sr-only">ドキュメントを全文検索</span><input id="doc-query" type="search" placeholder="Docs内を全文検索…" autocomplete="off"></label><label for="doc-category" class="sr-only">分類</label><select id="doc-category"><option value="all">すべての分類</option>${docGroups.map(([key, title]) => `<option value="${key}">${title}</option>`).join("")}</select><span class="result-count" id="doc-count" role="status">${technicalDocs.length} 件</span></div>
  <noscript><p class="notice">全文検索にはJavaScriptが必要です。左の一覧、または下の目次からすべての記事を読めます。</p></noscript>
  <div id="doc-empty" class="search-empty" hidden><p>一致する記事がありません。別の語で検索してください。</p><button id="doc-reset" type="button">検索条件をクリア</button></div>
  ${docGroups
    .map(
      ([category, title]) =>
        `<section id="${groupId(category)}" data-doc-group><h2>${title}</h2><div class="doc-list">${technicalDocs
          .filter((doc) => doc.category === category)
          .map(row)
          .join("")}</div></section>`,
    )
    .join("")}`;
await mkdir(join(output, "docs"), { recursive: true });
await writeFile(
  join(output, "docs/index.html"),
  wikiPage(
    "ドキュメント",
    "Vylineの機能・データ・運用・開発の資料",
    "docs",
    docsIntroduction,
    docGroups.map(([category, title]) => ({ title, id: groupId(category) })),
  ),
);

for (const doc of metadata) {
  const { html, headings } = renderMarkdown(doc.markdown, doc.path);
  const siblings = sectionDocs(doc.section as Section);
  const index = siblings.findIndex((item) => item.path === doc.path);
  const previous = siblings[index - 1];
  const next = siblings[index + 1];
  const pager = `<nav class="article-pager" aria-label="記事移動">${previous ? `<a href="${previous.url}"><small>前の記事</small>← ${escapeHtml(previous.title)}</a>` : "<span></span>"}${next ? `<a href="${next.url}"><small>次の記事</small>${escapeHtml(next.title)} →</a>` : `<a href="${base}${doc.section}/"><small>一覧へ戻る</small>${sectionTitle(doc.section as Section)} →</a>`}</nav>`;
  const content = `${html}<div class="article-source"><a href="${github + doc.path}">Markdown原文を読む ↗</a><a href="${base}${doc.section}/#${groupId(doc.category)}">${escapeHtml(doc.category)}の資料一覧</a></div>${pager}`;
  const article = wikiPage(
    doc.title,
    doc.summary,
    doc.section as Section,
    content,
    headings,
    doc.path,
    doc.category,
  );
  const destination =
    doc.path === repositoryMapSource
      ? join(output, "links", "index.html")
      : join(output, "guide", doc.path.replace(/\.md$/, ".html"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, article);
}
console.log(
  `Built home, installation, technical Docs + ${metadata.length} articles for ${base} in ${output}`,
);
