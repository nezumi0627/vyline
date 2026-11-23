import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { documents, version } from "../Vyline/website/site-data.js";

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
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const forward = (path: string) => path.split(sep).join("/");
const docUrl = (path: string) => path === repositoryMapSource ? `${base}links/` : `${base}guide/${path.replace(/\.md$/, ".html")}`;
const published = new Set(documents.map(([path]) => path));

await mkdir(output, { recursive: true });
const realOutput = await realpath(output);
const realRoot = await realpath(root);
const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};
if (inside(realOutput, realRoot) || ["docs", "Vyline", "scripts", ".github", "logo"].some((path) => inside(join(realRoot, path), realOutput))) {
  throw new Error("Refusing to write website output into source directories");
}
const entries = await readdir(output);
if (entries.length && !(await Bun.file(join(output, ".vyline-site")).exists())) {
  throw new Error("Refusing to overwrite a nonempty, unmanaged directory");
}

const metadata = await Promise.all(documents.map(async ([path, category, title, summary]) => {
  const markdown = await readFile(join(root, path), "utf8");
  return { path, category, title, summary, markdown, url: docUrl(path) };
}));
await mkdir(join(output, "assets"), { recursive: true });
await writeFile(join(output, ".vyline-site"), "Vyline documentation build\n");
for (const name of ["site.css", "site.js"]) await copyFile(join(source, name), join(output, "assets", name));
await copyFile(join(source, "assets/hero-stars.png"), join(output, "assets/hero-stars.png"));
await copyFile(join(root, "logo/assets/mono/original.svg"), join(output, "assets/logo.svg"));
await copyFile(join(root, "logo/LICENCE"), join(output, "assets/LOGO-LICENCE.txt"));
await writeFile(join(output, ".nojekyll"), "");

function searchableText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_>#|~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
await writeFile(join(output, "search.json"), JSON.stringify(metadata.map(({ markdown, ...doc }) => ({ ...doc, content: searchableText(markdown) }))));

const commonHeader = (current = "") => `<header class="site-header wrap"><a class="brand" href="${base}" aria-label="Vyline ホーム"><img src="${base}assets/logo.svg" width="32" height="32" alt=""><span>Vyline</span></a><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav">メニュー</button><nav class="site-nav" id="site-nav" aria-label="メインナビゲーション"><a href="${base}#download"${current === "download" ? ' aria-current="page"' : ""}>ダウンロード</a><a href="${base}guide/"${current === "docs" ? ' aria-current="page"' : ""}>Docs</a><a href="https://github.com/nezumi0627/vyline" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a></nav></header>`;
const commonFooter = `<footer class="site-footer"><div class="wrap footer-inner"><a class="brand footer-brand" href="${base}"><img src="${base}assets/logo.svg" width="28" height="28" alt=""><span>Vyline</span></a><nav aria-label="補助リンク"><a href="${base}guide/">Docs</a><a href="${blogBase}">ブログ</a><a href="${statusUrl}">対応状況</a><a href="${base}links/">関連リポジトリ</a><a href="https://github.com/nezumi0627/vyline" target="_blank" rel="noreferrer">GitHub ↗</a></nav><p>Software © Project Vyline / MIT · Logo © 2026 y2mc / <a href="${base}assets/LOGO-LICENCE.txt">CC BY 4.0</a></p></div></footer>`;
const pageStart = (title: string, summary: string, extraClass: string, main: string, current = "") => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0a0a09"><meta name="description" content="${escapeHtml(summary)}"><title>${escapeHtml(title)} | Vyline</title><link rel="icon" href="${base}assets/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script></head><body><a class="skip-link" href="#main">本文へ移動</a>${commonHeader(current)}<main id="main" class="${extraClass}">${main}</main>${commonFooter}</body></html>`;

function sourceLink(path: string, href: string, postUrls = new Map<string, string>()) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return href;
  const match = href.match(/^([^?#]*)([?#].*)?$/)!;
  if (!match[1]) return href;
  let decoded: string;
  try { decoded = decodeURIComponent(match[1]); } catch { return href; }
  const target = forward(relative(root, resolve(dirname(join(root, path)), decoded)));
  if (target.startsWith("../")) return href;
  if (postUrls.has(target)) return postUrls.get(target)!;
  return `${published.has(target) ? docUrl(target) : github + target}${match[2] ?? ""}`;
}

function slug(text: string) {
  return text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").trim().replace(/\s/g, "-");
}

function renderMarkdown(markdown: string, sourcePath: string, postUrls = new Map<string, string>()) {
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
  html = html.replace(/(href|src)="([^"]*)"/g, (_, attribute, href) => {
    const linked = sourceLink(sourcePath, href.replaceAll("&amp;", "&"), postUrls);
    const url = attribute === "src" && linked.startsWith(github)
      ? linked.replace(github, "https://raw.githubusercontent.com/nezumi0627/vyline/main/")
      : linked;
    return `${attribute}="${escapeHtml(url)}"`;
  }).replace(/<table>/g, '<div class="table-scroll"><table>').replace(/<\/table>/g, "</table></div>");
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
  const value = (key: string) => (values.get(key) ?? "").replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
  const title = value("title");
  const summary = value("summary");
  const date = value("date");
  const category = value("category");
  const publishedValue = value("published");
  const tagsValue = value("tags").replace(/^\[/, "").replace(/\]$/, "");
  const tags = tagsValue.split(",").map((tag) => tag.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  if (!title || !summary || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !category || !["true", "false"].includes(publishedValue)) {
    throw new Error(`Blog post frontmatter requires title, summary, date, category, and published: ${sourcePath}`);
  }
  const slugName = sourcePath.split(/[\\/]/).at(-1)!.replace(/\.md$/, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugName) || slugName === "index") {
    throw new Error(`Blog filename must be a lowercase hyphenated slug: ${sourcePath}`);
  }
  return { slug: slugName, title, summary, date, category, tags, published: publishedValue === "true", markdown: match[2].trim(), sourcePath };
}

const categoryGroups = [...new Set(metadata.map((doc) => doc.category))].map((category) => {
  const rows = metadata.filter((doc) => doc.category === category).map((doc) => `<li data-doc-path="${escapeHtml(doc.path)}"><a href="${doc.url}"><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.summary)}</small></a></li>`).join("");
  return `<section class="doc-category-group" data-doc-category><h2>${escapeHtml(category)}</h2><ul class="doc-list">${rows}</ul></section>`;
}).join("");
const docsIndex = `<div class="wrap docs-index"><header class="docs-index-header"><h1>ドキュメント</h1><p>導入、使い方、データ、開発資料を目的や言葉から探せます。掲載内容はリポジトリのMarkdownを元に生成しています。</p></header><form class="search-form" role="search"><label for="doc-search">ドキュメントを全文検索 <span class="search-shortcut"><kbd>/</kbd> で検索欄へ移動</span></label><div class="search-field"><input id="doc-search" type="search" placeholder="例：QRログイン、バックアップ、Docker" autocomplete="off" aria-controls="document-list" aria-describedby="search-status"><kbd aria-hidden="true">/</kbd></div></form><p class="search-status" id="search-status" role="status" aria-live="polite">${metadata.length}件のドキュメント</p><div id="document-list">${categoryGroups}</div><noscript><p>検索にはJavaScriptが必要です。上の一覧から記事を選んでください。</p></noscript></div>`;
await mkdir(join(output, "guide"), { recursive: true });
await writeFile(join(output, "guide", "index.html"), pageStart("ドキュメント", "Vylineの導入、使い方、データ、開発資料", "docs-index-page", docsIndex, "docs"));
await writeFile(join(output, "index.html"), (await readFile(join(source, "index.html"), "utf8")).replaceAll("{{BASE}}", base).replaceAll("{{VERSION}}", version));

const blogFiles = (await readdir(blogDirectory)).filter((file) => file.endsWith(".md") && file !== "README.md" && !file.startsWith("_"));
const allPosts = (await Promise.all(blogFiles.map(async (file) => {
  const sourcePath = `Vyline/website/blog/${file}`;
  return readFrontmatter(sourcePath, await readFile(join(root, sourcePath), "utf8"));
}))).sort((a, b) => b.date.localeCompare(a.date));
const posts = allPosts.filter((post) => post.published);
const postUrls = new Map(posts.map((post) => [post.sourcePath, `${blogBase}${post.slug}/`]));
const blogRows = posts.map((post) => `<li><a class="journal-row" href="${blogBase}${post.slug}/"><span class="journal-date">${escapeHtml(post.date.replaceAll("-", "."))}</span><span class="journal-copy"><span class="journal-category">${escapeHtml(post.category)}</span><strong>${escapeHtml(post.title)}</strong><small>${escapeHtml(post.summary)}</small><span class="journal-tags">${post.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</span></span></a></li>`).join("");
const blogIndex = `<div class="journal-layout wrap"><header class="journal-head"><h1>Vylineのブログ</h1><p class="journal-lead">開発の更新、機能の背景、利用に関する案内を掲載しています。</p><p class="journal-authoring">記事を追加する場合は<a href="${blogBase}write/">執筆ガイド</a>を参照してください。</p></header><section class="journal-feed" aria-labelledby="journal-feed-title"><div class="journal-feed-heading"><h2 id="journal-feed-title">記事一覧</h2><span>${posts.length}件</span></div>${posts.length ? `<ol class="journal-list">${blogRows}</ol>` : `<p class="journal-empty">記事はありません。</p>`}</section><aside class="journal-side"><strong>Vyline ${version}</strong><span>現在の安定版</span><a href="${statusUrl}">機能の対応状況を見る</a></aside></div>`;
await mkdir(join(output, "blog"), { recursive: true });
await writeFile(join(output, "blog", "index.html"), pageStart("ブログ", "Vylineの開発記事と利用案内", "journal-page", blogIndex));

const authorGuidePath = "Vyline/website/blog/README.md";
const authorGuide = renderMarkdown(await readFile(join(root, authorGuidePath), "utf8"), authorGuidePath, postUrls).html;
const authorPage = `<div class="journal-article-layout wrap"><article class="journal-article"><nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span><a href="${blogBase}">ブログ</a><span>/</span><span>執筆ガイド</span></nav><header class="journal-article-head"><h1>ブログ記事の執筆ガイド</h1><p class="journal-lead">Markdownから記事ページを生成する手順です。</p></header><div class="journal-prose">${authorGuide}</div><div class="journal-article-end"><a href="https://github.com/nezumi0627/vyline/tree/main/Vyline/website/blog">記事フォルダーを見る ↗</a><a href="${blogBase}">ブログ一覧へ戻る</a></div></article></div>`;
await mkdir(join(output, "blog", "write"), { recursive: true });
await writeFile(join(output, "blog", "write", "index.html"), pageStart("執筆ガイド", "Vylineブログ記事の追加方法", "journal-article-page", authorPage));

for (let index = 0; index < posts.length; index++) {
  const post = posts[index];
  const { html, headings } = renderMarkdown(post.markdown, post.sourcePath, postUrls);
  const toc = headings.map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`).join("");
  const previous = posts[index - 1];
  const next = posts[index + 1];
  const pager = `<nav class="journal-pager" aria-label="記事移動">${previous ? `<a href="${blogBase}${previous.slug}/"><small>前の記事</small>${escapeHtml(previous.title)}</a>` : "<span></span>"}${next ? `<a href="${blogBase}${next.slug}/"><small>次の記事</small>${escapeHtml(next.title)}</a>` : "<span></span>"}</nav>`;
  const article = `<div class="journal-article-layout wrap"><article class="journal-article"><nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span><a href="${blogBase}">ブログ</a><span>/</span><span>${escapeHtml(post.category)}</span></nav><header class="journal-article-head"><p class="journal-date">${escapeHtml(post.date.replaceAll("-", "."))} · ${escapeHtml(post.category)}</p><h1>${escapeHtml(post.title)}</h1><p class="journal-lead">${escapeHtml(post.summary)}</p><div class="journal-byline"><span>Project Vyline</span>${post.tags.map((tag) => `<span class="journal-tag">${escapeHtml(tag)}</span>`).join("")}</div></header><div class="journal-prose">${html}</div><div class="journal-article-end"><a href="${github + post.sourcePath}">Markdown原文を見る ↗</a><a href="${blogBase}">ブログ一覧へ戻る</a></div>${pager}</article><aside class="journal-toc" aria-label="この記事の目次"><h2>この記事の目次</h2>${toc || `<a href="#main">本文</a>`}<a href="${statusUrl}">機能の対応状況</a></aside></div>`;
  await mkdir(join(output, "blog", post.slug), { recursive: true });
  await writeFile(join(output, "blog", post.slug, "index.html"), pageStart(post.title, post.summary, "journal-article-page", article));
}

const capabilityMarkdown = await readFile(join(root, capabilitySource), "utf8");
const matrixSection = capabilityMarkdown.split(/^## Matrix\s*$/m)[1]?.split(/^## /m)[0] ?? "";
const matrixLines = matrixSection.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
if (matrixLines.length < 3) throw new Error(`Could not read capability table from ${capabilitySource}`);
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
const headers = cells(matrixLines[0]);
const column = (name: string) => {
  const index = headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
  if (index < 0) throw new Error(`Missing '${name}' column in ${capabilitySource}`);
  return index;
};
const capabilityRows = matrixLines.slice(2).map(cells);
const statusLabels: Record<string, string> = { verified: "確認済み", partial: "一部確認", unverified: "未検証", unsupported: "未対応" };
const statusCounts = Object.fromEntries(Object.keys(statusLabels).map((status) => [status, capabilityRows.filter((row) => row[column("status")] === status).length]));
const statusRows = capabilityRows.map((row) => {
  const status = row[column("status")];
  return `<tr><th scope="row"><strong>${escapeHtml(row[column("Capability")])}</strong><small>${escapeHtml(row[column("user behavior")])}</small></th><td><span class="capability-label capability-${escapeHtml(status)}">${escapeHtml(statusLabels[status] ?? "要確認")}</span></td><td>${escapeHtml(row[column("verification")].replace(/`/g, ""))}</td><td>${escapeHtml(row[column("missing link / limitation")].replace(/`/g, ""))}</td></tr>`;
}).join("");
const updated = capabilityMarkdown.match(/^最終更新:\s*(.+)$/m)?.[1] ?? "日付未記載";
const statusMain = `<div class="status-layout wrap"><header class="status-head"><h1>機能の対応状況</h1><p class="journal-lead">機能の実装状況と確認できた範囲を掲載しています。実装の有無と実環境での検証結果を分けて記録します。</p><p class="status-updated">資料更新 ${escapeHtml(updated)} · <a href="${base}guide/docs/feature-capabilities.html">検証資料を読む ↗</a></p></header><div class="status-counts" aria-label="対応状況の件数"><div><strong>${statusCounts.verified}</strong><span>確認済み</span></div><div><strong>${statusCounts.partial}</strong><span>一部確認</span></div><div><strong>${statusCounts.unverified}</strong><span>未検証</span></div><div><strong>${statusCounts.unsupported}</strong><span>未対応</span></div></div><div class="status-note"><p><strong>一部確認は未実装という意味ではありません。</strong> 実装を確認できても、実アカウントでの動作確認などが残る場合は、その範囲を明記しています。</p><a href="${base}guide/docs/feature-capabilities.html">判定方法と機能ごとの詳細 ↗</a></div><div class="capability-table-wrap"><table class="capability-table"><thead><tr><th scope="col">機能</th><th scope="col">状況</th><th scope="col">確認できたこと</th><th scope="col">残っている確認</th></tr></thead><tbody>${statusRows}</tbody></table></div></div>`;
await mkdir(join(output, "status"), { recursive: true });
await writeFile(join(output, "status", "index.html"), pageStart("機能の対応状況", "Vylineの機能実装と検証の進捗", "status-page", statusMain));

for (let index = 0; index < metadata.length; index++) {
  const doc = metadata[index];
  const { html, headings } = renderMarkdown(doc.markdown, doc.path, postUrls);
  const sidebar = [...new Set(metadata.map((item) => item.category))].map((category) => `<p class="sidebar-category">${escapeHtml(category)}</p>${metadata.filter((item) => item.category === category).map((item) => `<a href="${item.url}"${item.path === doc.path ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a>`).join("")}`).join("");
  const toc = headings.map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`).join("");
  const previous = metadata[index - 1];
  const next = metadata[index + 1];
  const pagination = `<nav class="article-pagination" aria-label="ドキュメント移動">${previous ? `<a href="${previous.url}"><small>前のドキュメント</small><strong>${escapeHtml(previous.title)}</strong></a>` : "<span></span>"}${next ? `<a href="${next.url}"><small>次のドキュメント</small><strong>${escapeHtml(next.title)}</strong></a>` : "<span></span>"}</nav>`;
  const article = `<!doctype html><html lang="${doc.path.includes(".en.") ? "en" : "ja"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0a0a09"><meta name="description" content="${escapeHtml(doc.summary)}"><title>${escapeHtml(doc.title)} | Vyline</title><link rel="icon" href="${base}assets/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script></head><body><a class="skip-link" href="#main">本文へ移動</a>${commonHeader("docs")}<main id="main" class="article-layout wrap"><aside class="docs-sidebar"><div class="sidebar-desktop"><h2>ドキュメント</h2><nav class="sidebar-links" aria-label="ドキュメント一覧">${sidebar}</nav></div><details class="sidebar-mobile"><summary>ドキュメント一覧</summary><nav class="sidebar-links" aria-label="ドキュメント一覧">${sidebar}</nav></details></aside><article class="article-content"><nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span><a href="${base}guide/">Docs</a><span>/</span><span>${escapeHtml(doc.category)}</span></nav><div class="article-actions"><a class="search-shortcut" href="${base}guide/#search">ドキュメントを検索 <kbd aria-hidden="true">/</kbd></a><a class="article-source-link" href="${github + doc.path}">Markdown原文 ↗</a></div>${html}${pagination}</article><aside class="docs-toc"><h2>このページ</h2><nav aria-label="ページ内目次">${toc || `<a href="#main">本文</a>`}</nav></aside></main>${commonFooter}</body></html>`;
  const destination = doc.path === repositoryMapSource ? join(output, "links", "index.html") : join(output, "guide", doc.path.replace(/\.md$/, ".html"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, article);
}
console.log(`Built ${metadata.length} guides, blog, and capability pages for ${base} in ${output}`);
