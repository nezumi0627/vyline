import { copyFile, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
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

// Never clear a destination. Refuse existing source/unmanaged directories,
// including symlinks to them, before writing any generated files.
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
for (const name of ["site.css", "site.js", "site-data.js", "navigation.js"]) await copyFile(join(source, name), join(output, "assets", name));
await copyFile(join(source, "assets/hero-stars.png"), join(output, "assets/hero-stars.png"));
await copyFile(join(root, "logo/assets/mono/original.svg"), join(output, "assets/logo.svg"));
await copyFile(join(root, "logo/LICENCE"), join(output, "assets/LOGO-LICENCE.txt"));
await writeFile(join(output, ".nojekyll"), "");
await writeFile(join(output, "search.json"), JSON.stringify(metadata.map(({ markdown, ...doc }) => doc)));

function row(doc: typeof metadata[number]) {
  const searchableMarkdown = doc.markdown.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  const terms = `${doc.title} ${doc.summary} ${doc.category} ${searchableMarkdown.replace(/[`#*|<>]/g, " ")}`.toLocaleLowerCase();
  const prefixLength = `${doc.title} ${doc.summary} ${doc.category} `.length;
  return `<a class="document-row" href="${doc.url}" data-category="${escapeHtml(doc.category)}" data-title="${escapeHtml(doc.title)}" data-summary="${escapeHtml(doc.summary)}" data-content-offset="${prefixLength}" data-search="${escapeHtml(terms)}"><span class="doc-category">${escapeHtml(doc.category)}</span><span><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.summary)}</small><small class="search-match"></small></span><span aria-hidden="true">↗</span></a>`;
}
const home = (await readFile(join(source, "index.html"), "utf8")).replaceAll("{{BASE}}", base).replace("{{DOCUMENTS}}", metadata.map(row).join("\n"));
await writeFile(join(output, "index.html"), home);

function sourceLink(path: string, href: string) {
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
  html = html.replace(/(href|src)="([^"]*)"/g, (_, attribute, href) => {
    const linked = sourceLink(sourcePath, href.replaceAll("&amp;", "&"));
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
  const published = value("published");
  const tagsValue = value("tags").replace(/^\[/, "").replace(/\]$/, "");
  const tags = tagsValue.split(",").map((tag) => tag.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  if (!title || !summary || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !category || !["true", "false"].includes(published)) {
    throw new Error(`Blog post frontmatter requires title, summary, date, category, and published: ${sourcePath}`);
  }
  const slugName = sourcePath.split(/[\\/]/).at(-1)!.replace(/\.md$/, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugName) || slugName === "index") {
    throw new Error(`Blog filename must be a lowercase hyphenated slug: ${sourcePath}`);
  }
  return { slug: slugName, title, summary, date, category, tags, published: published === "true", markdown: match[2].trim(), sourcePath };
}

const blogFiles = (await readdir(blogDirectory)).filter((file) => file.endsWith(".md") && file !== "README.md" && !file.startsWith("_"));
const allPosts = (await Promise.all(blogFiles.map(async (file) => {
  const sourcePath = `Vyline/website/blog/${file}`;
  return readFrontmatter(sourcePath, await readFile(join(blogDirectory, file), "utf8"));
}))).sort((a, b) => b.date.localeCompare(a.date));
const posts = allPosts.filter((post) => post.published);
const postUrls = new Map(posts.map((post) => [post.sourcePath, `${blogBase}${post.slug}/`]));

const commonHeader = `<header class="site-header wrap"><a class="brand" href="${base}" aria-label="Vyline ホーム"><img src="${base}assets/logo.svg" width="36" height="36" alt=""><span>Vyline</span></a><button class="menu-button" aria-expanded="false" aria-controls="navigation">メニュー <span aria-hidden="true">＋</span></button><nav id="navigation" aria-label="メインナビゲーション"><a href="${base}#start">はじめる</a><a href="${blogBase}">ブログ</a><a href="${statusUrl}">対応状況</a><a href="${base}#docs">ドキュメント</a><a href="https://github.com/nezumi0627/vyline">GitHub ↗</a></nav></header>`;
const commonFooter = `<footer class="site-footer wrap"><div class="footer-top"><a class="brand" href="${base}"><img src="${base}assets/logo.svg" width="32" height="32" alt=""><span>Vyline</span></a><p>会話を、自分の環境で。</p><nav aria-label="フッターナビゲーション"><a href="${blogBase}">ブログ</a><a href="${statusUrl}">対応状況</a><a href="${base}links/">関連リポジトリ</a><a href="https://github.com/nezumi0627/vyline">GitHub ↗</a><a href="${base}guide/docs/user-guide/privacy-and-data.html">プライバシー</a></nav></div><p class="footer-legal">Software © Project Vyline / MIT · Logo © 2026 y2mc / <a href="${base}assets/LOGO-LICENCE.txt">CC BY 4.0</a></p></footer>`;

const pageStart = (title: string, summary: string, extraClass: string, main: string) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08090a"><meta name="description" content="${escapeHtml(summary)}"><title>${escapeHtml(title)} | Vyline</title><link rel="icon" href="${base}assets/logo.svg"><link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script></head><body><div class="world-background" aria-hidden="true"></div><a class="skip-link" href="#main">本文へ移動</a>${commonHeader}<main id="main" class="${extraClass}">${main}</main>${commonFooter}</body></html>`;

const blogRows = posts.map((post, index) => `<li><a class="journal-row" href="${blogBase}${post.slug}/"><span class="journal-date">${escapeHtml(post.date.replaceAll("-", "."))}</span><span class="journal-copy"><span class="journal-category">${escapeHtml(post.category)}</span><strong>${escapeHtml(post.title)}</strong><small>${escapeHtml(post.summary)}</small><span class="journal-tags">${post.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</span></span><span class="journal-number">${String(index + 1).padStart(2, "0")}</span></a></li>`).join("");
const blogIntro = `<div class="journal-head"><p class="journal-coordinate">VYLINE / JOURNAL</p><h1>開発の記録を、<br>ここに残す。</h1><p class="journal-lead">機能を作った理由や、使い方の背景。Vylineの更新を、記事でたどれます。</p><p class="journal-authoring">記事はMarkdownで追加できます。<a href="${blogBase}write/">書き方を見る ↗</a></p></div>`;
const blogIndex = `<div class="journal-layout wrap">${blogIntro}<section class="journal-feed" aria-labelledby="journal-feed-title"><div class="journal-feed-heading"><h2 id="journal-feed-title">記事</h2><span>${String(posts.length).padStart(2, "0")} POSTS</span></div>${posts.length ? `<ol class="journal-list">${blogRows}</ol>` : `<p class="journal-empty">記事はまだありません。最初の記事をMarkdownで追加できます。</p>`}</section><aside class="journal-side"><p>NOW</p><strong>Vyline ${version}</strong><span>開発ノートとリリースの記録</span><a href="${statusUrl}">機能の対応状況を見る ↗</a></aside></div>`;
await mkdir(join(output, "blog"), { recursive: true });
await writeFile(join(output, "blog", "index.html"), pageStart("ブログ", "Vylineの開発ノートとリリース記事", "journal-page", blogIndex));
const authorGuidePath = "Vyline/website/blog/README.md";
const authorGuideSource = await readFile(join(root, authorGuidePath), "utf8");
const { html: authorGuideHtml } = renderMarkdown(authorGuideSource, authorGuidePath);
const authorGuide = `<div class="journal-article-layout wrap"><article class="journal-article"><nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span><a href="${blogBase}">ブログ</a><span>/</span><span>記事の書き方</span></nav><header class="journal-article-head"><p class="journal-coordinate">VYLINE / WRITING</p><h1>記事の書き方</h1><p class="journal-lead">Markdownを追加すると、記事一覧とページが自動で生成されます。</p></header><div class="journal-prose">${authorGuideHtml}</div><div class="journal-article-end"><a href="https://github.com/nezumi0627/vyline/tree/main/Vyline/website/blog">記事フォルダーを開く ↗</a><a href="${blogBase}">ブログ一覧へ戻る</a></div></article></div>`;
await mkdir(join(output, "blog", "write"), { recursive: true });
await writeFile(join(output, "blog", "write", "index.html"), pageStart("記事の書き方", "VylineブログにMarkdownで記事を追加する", "journal-article-page", authorGuide));

for (let index = 0; index < posts.length; index++) {
  const post = posts[index];
  const { html, headings } = renderMarkdown(post.markdown, post.sourcePath);
  const toc = headings.map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a>`).join("");
  const previous = posts[index - 1];
  const next = posts[index + 1];
  const articleContent = `<div class="journal-article-layout wrap"><article class="journal-article"><nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span><a href="${blogBase}">ブログ</a><span>/</span><span>${escapeHtml(post.category)}</span></nav><header class="journal-article-head"><p class="journal-coordinate">${escapeHtml(post.date.replaceAll("-", "."))} <span>/</span> ${escapeHtml(post.category)}</p><h1>${escapeHtml(post.title)}</h1><p class="journal-lead">${escapeHtml(post.summary)}</p><div class="journal-byline"><span>Project Vyline</span>${post.tags.map((tag) => `<span class="journal-tag">${escapeHtml(tag)}</span>`).join("")}</div></header><div class="journal-prose">${html}</div><div class="journal-article-end"><a href="${github + post.sourcePath}">Markdown原文を見る ↗</a><a href="${blogBase}">記事一覧へ戻る</a></div><nav class="journal-pager" aria-label="記事移動">${previous ? `<a href="${blogBase}${previous.slug}/"><small>前の記事</small>${escapeHtml(previous.title)} →</a>` : `<span></span>`}${next ? `<a href="${blogBase}${next.slug}/"><small>次の記事</small>← ${escapeHtml(next.title)}</a>` : `<span></span>`}</nav></article><aside class="journal-toc" aria-label="この記事の目次"><h2>この記事で</h2>${toc || `<a href="#main">本文</a>`}<a class="toc-status-link" href="${statusUrl}">対応状況 ↗</a></aside></div>`;
  await mkdir(join(output, "blog", post.slug), { recursive: true });
  await writeFile(join(output, "blog", post.slug, "index.html"), pageStart(post.title, post.summary, "journal-article-page", articleContent));
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
const capabilityStatus = column("status");
const statusCounts = Object.fromEntries(Object.keys(statusLabels).map((status) => [status, capabilityRows.filter((row) => row[capabilityStatus] === status).length]));
const statusRows = capabilityRows.map((row) => {
  const status = row[capabilityStatus];
  const label = statusLabels[status] ?? "要確認";
  return `<tr><th scope="row"><strong>${escapeHtml(row[column("Capability")])}</strong><small>${escapeHtml(row[column("user behavior")])}</small></th><td><span class="capability-label capability-${escapeHtml(status)}">${escapeHtml(label)}</span></td><td>${escapeHtml(row[column("verification")].replace(/`/g, ""))}</td><td>${escapeHtml(row[column("missing link / limitation")].replace(/`/g, ""))}</td></tr>`;
}).join("");
const updated = capabilityMarkdown.match(/^最終更新:\s*(.+)$/m)?.[1] ?? "日付未記載";
const statusMain = `<div class="status-layout wrap"><header class="status-head"><p class="journal-coordinate">VYLINE / CAPABILITIES</p><h1>機能の現在地を、<br>根拠とともに。</h1><p class="journal-lead">機能ごとの実装状況と、確認できた範囲を公開しています。コードがあることと、実環境で確かめられたことを分けて記録します。</p><p class="status-updated">資料更新 ${escapeHtml(updated)} <span>·</span> <a href="${base}guide/docs/feature-capabilities.html">検証資料を読む ↗</a></p></header><div class="status-counts" aria-label="対応状況の件数"><div><strong>${statusCounts.verified}</strong><span>確認済み</span></div><div><strong>${statusCounts.partial}</strong><span>一部確認</span></div><div><strong>${statusCounts.unverified}</strong><span>未検証</span></div><div><strong>${statusCounts.unsupported}</strong><span>未対応</span></div></div><div class="status-note"><p><strong>「一部確認」は未実装という意味ではありません。</strong> 実装を確認できても、LINEの実アカウントを使った動作確認などが残っている場合は、その範囲を明記しています。</p><a href="${base}guide/docs/feature-capabilities.html">判定方法と各機能の詳細 ↗</a></div><div class="capability-table-wrap"><table class="capability-table"><thead><tr><th scope="col">機能</th><th scope="col">状況</th><th scope="col">確認できたこと</th><th scope="col">残っている確認</th></tr></thead><tbody>${statusRows}</tbody></table></div></div>`;
await mkdir(join(output, "status"), { recursive: true });
await writeFile(join(output, "status", "index.html"), pageStart("対応状況", "Vylineの機能実装と検証の進捗", "status-page", statusMain));

for (let index = 0; index < metadata.length; index++) {
  const doc = metadata[index];
  const headings: Array<{ title: string; id: string }> = [];
  const ids = new Map<string, number>();
  let html = Bun.markdown.html(doc.markdown);
  html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, level, title) => {
    const key = slug(title); const count = ids.get(key) ?? 0; ids.set(key, count + 1);
    const id = `${key}${count ? `-${count}` : ""}`;
    if (level === "2") headings.push({ title: title.replace(/<[^>]*>/g, ""), id });
    return `<h${level} id="${escapeHtml(id)}">${title}</h${level}>`;
  });
  html = html.replace(/(href|src)="([^"]*)"/g, (_, attribute, href) => {
    const linked = sourceLink(doc.path, href.replaceAll("&amp;", "&"));
    // Images must use the raw-content origin when not part of the static bundle.
    const url = attribute === "src" && linked.startsWith(github) ? linked.replace(github, "https://raw.githubusercontent.com/nezumi0627/vyline/main/") : linked;
    return `${attribute}="${escapeHtml(url)}"`;
  }).replace(/<table>/g, '<div class="table-scroll"><table>').replace(/<\/table>/g, "</table></div>");
  const sidebar = metadata.map((item, i) => `${i === 0 || metadata[i - 1].category !== item.category ? `<p class="sidebar-category">${escapeHtml(item.category)}</p>` : ""}<a href="${item.url}"${item.path === doc.path ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a>`).join("");
  const next = metadata[(index + 1) % metadata.length];
  const article = `<!doctype html><html lang="${doc.path.includes(".en.") ? "en" : "ja"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08090a"><meta name="description" content="${escapeHtml(doc.summary)}"><title>${escapeHtml(doc.title)} | Vyline</title><link rel="icon" href="${base}assets/logo.svg"><link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script></head><body><div class="world-background" aria-hidden="true"></div><a class="skip-link" href="#main">本文へ移動</a><header class="site-header wrap"><a class="brand" href="${base}" aria-label="Vyline ホーム"><img src="${base}assets/logo.svg" width="36" height="36" alt=""><span>Vyline</span></a><button class="menu-button" aria-expanded="false" aria-controls="navigation">メニュー <span aria-hidden="true">＋</span></button><nav id="navigation" aria-label="メインナビゲーション"><a href="${base}#start">導入ツアー</a><a href="${blogBase}">ブログ</a><a href="${statusUrl}">対応状況</a><a href="${base}#docs">目的から探す</a><a href="${github + doc.path}">Markdown原文 ↗</a></nav></header><div class="article-layout wrap"><aside class="article-sidebar" aria-label="ドキュメント一覧"><h2>Docs / v${version}</h2>${sidebar}</aside><main id="main" class="article-content"><nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span><a href="${base}#docs">ドキュメント</a><span>/</span><span>${escapeHtml(doc.category)}</span></nav>${html}<div class="article-source"><a href="${github + doc.path}">Markdown原文を読む ↗</a><a href="${base}#docs">目的から探す</a></div><a class="article-next" href="${next.url}"><small>続けて読む</small>${escapeHtml(next.title)} →</a></main><aside class="article-toc" aria-label="このページの目次"><h2>このページで</h2>${headings.map((heading) => `<a href="#${escapeHtml(heading.id)}">${heading.title}</a>`).join("")}</aside></div><footer class="site-footer wrap"><p>Software © Project Vyline / MIT · Logo © 2026 y2mc / <a href="${base}assets/LOGO-LICENCE.txt">CC BY 4.0</a></p></footer></body></html>`;
  const destination = doc.path === repositoryMapSource ? join(output, "links", "index.html") : join(output, "guide", doc.path.replace(/\.md$/, ".html"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, article);
}
console.log(`Built tour + ${metadata.length} guides for ${base} in ${output}`);
