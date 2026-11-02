import { copyFile, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { documents, version } from "../Vyline/website/site-data.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "Vyline/website");
const output = resolve(process.argv[2] ?? join(root, "dist-landing"));
const base = "/Vyline/";
const github = "https://github.com/nezumi0627/vyline/blob/main/";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const forward = (path: string) => path.split(sep).join("/");
const docUrl = (path: string) => `${base}guide/${path.replace(/\.md$/, ".html")}`;
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
await copyFile(join(root, "logo/assets/mono/original.svg"), join(output, "assets/logo.svg"));
await copyFile(join(root, "logo/LICENCE"), join(output, "assets/LOGO-LICENCE.txt"));
await writeFile(join(output, ".nojekyll"), "");
await writeFile(join(output, "search.json"), JSON.stringify(metadata.map(({ markdown, ...doc }) => doc)));

function row(doc: typeof metadata[number]) {
  const terms = `${doc.title} ${doc.summary} ${doc.category} ${doc.markdown.replace(/[`#*|<>]/g, " ")}`.toLocaleLowerCase();
  return `<a class="document-row" href="${doc.url}" data-category="${escapeHtml(doc.category)}" data-search="${escapeHtml(terms)}"><span class="doc-category">${escapeHtml(doc.category)}</span><span><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.summary)}</small></span><span aria-hidden="true">↗</span></a>`;
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
  return `${published.has(target) ? docUrl(target) : github + target}${match[2] ?? ""}`;
}
function slug(text: string) {
  return text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").trim().replace(/\s/g, "-");
}
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
  const article = `<!doctype html><html lang="${doc.path.includes(".en.") ? "en" : "ja"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08090a"><meta name="description" content="${escapeHtml(doc.summary)}"><title>${escapeHtml(doc.title)} | Vyline</title><link rel="icon" href="${base}assets/logo.svg"><link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script></head><body><div class="world-background" aria-hidden="true"></div><a class="skip-link" href="#main">本文へ移動</a><header class="site-header wrap"><a class="brand" href="${base}" aria-label="Vyline ホーム"><img src="${base}assets/logo.svg" width="36" height="36" alt=""><span>Vyline</span></a><button class="menu-button" aria-expanded="false" aria-controls="navigation">メニュー <span aria-hidden="true">＋</span></button><nav id="navigation" aria-label="メインナビゲーション"><a href="${base}#start">導入ツアー</a><a href="${base}#docs">目的から探す</a><a href="${github + doc.path}">Markdown原文 ↗</a></nav></header><div class="article-layout wrap"><aside class="article-sidebar" aria-label="ドキュメント一覧"><h2>Docs / v${version}</h2>${sidebar}</aside><main id="main" class="article-content"><nav class="breadcrumbs" aria-label="パンくず"><a href="${base}">ホーム</a><span>/</span><a href="${base}#docs">ドキュメント</a><span>/</span><span>${escapeHtml(doc.category)}</span></nav>${html}<div class="article-source"><a href="${github + doc.path}">Markdown原文を読む ↗</a><a href="${base}#docs">目的から探す</a></div><a class="article-next" href="${next.url}"><small>続けて読む</small>${escapeHtml(next.title)} →</a></main><aside class="article-toc" aria-label="このページの目次"><h2>このページで</h2>${headings.map((heading) => `<a href="#${escapeHtml(heading.id)}">${heading.title}</a>`).join("")}</aside></div><footer class="site-footer wrap"><p>Software © Project Vyline / MIT · Logo © 2026 y2mc / <a href="${base}assets/LOGO-LICENCE.txt">CC BY 4.0</a></p></footer></body></html>`;
  const destination = join(output, "guide", doc.path.replace(/\.md$/, ".html"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, article);
}
console.log(`Built tour + ${metadata.length} guides for ${base} in ${output}`);
