import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findMatch, matchRanges } from "./search-text.js";
import { parseBlogPost } from "./blog-meta.ts";

const root = resolve(import.meta.dir, "../..");

test("invalid blog metadata fails instead of silently hiding a post", () => {
  const valid =
    '---\ntitle: "Title"\nsummary: Summary\ndate: 2026-11-23\ncategory: Notes\npublished: true\n---\nBody';
  expect(parseBlogPost(valid, "post.md").published).toBe(true);
  expect(
    parseBlogPost(valid.replace("published: true", "published: false"), "post.md").published,
  ).toBe(false);
  for (const value of ["published: tru", "published:", ""]) {
    expect(() => parseBlogPost(valid.replace("published: true", value), "post.md")).toThrow();
  }
  expect(() => parseBlogPost(valid.replace('title: "Title"', "title:"), "post.md")).toThrow();
  expect(() => parseBlogPost(valid.replace("2026-11-23", "today"), "post.md")).toThrow();
  for (const delimiter of ["----", "---extra", "--- trailing"]) {
    expect(() =>
      parseBlogPost(valid.replace("\n---\nBody", `\n${delimiter}\nBody`), "post.md"),
    ).toThrow();
  }
  expect(parseBlogPost(valid.replaceAll("\n", "\r\n"), "post.md").body).toBe("Body");
  expect(parseBlogPost(valid.replace("\nBody", ""), "post.md").body).toBe("");
});

test("search keeps original offsets through Japanese Unicode normalization", () => {
  for (const [text, query, expected] of [
    ["🗃️ ㍿のメモ: バックアップで巻き戻す", "バックアップ", "バックアップ"],
    ["① 手順: ﾊﾞｯｸｱｯﾌﾟと復元", "バックアップ", "ﾊﾞｯｸｱｯﾌﾟ"],
    ["℡の補足: ＰＲＯＴＯＣＯＬ", "protocol", "ＰＲＯＴＯＣＯＬ"],
    ["㍿ の資料", "株式会社", "㍿"],
    ["か\u3099いと\u3099", "がいど", "か\u3099いと\u3099"],
  ]) {
    const match = findMatch(text, query);
    expect(match ? text.slice(match.start, match.end) : null).toBe(expected);
  }
  expect(findMatch("バックアップ", "")).toBeNull();
  expect(findMatch("ガイド", "存在しない語")).toBeNull();
  const content = "㍿の backup、設定の restore";
  expect(
    matchRanges(content, "backup restore").map(({ start, end }) => content.slice(start, end)),
  ).toEqual(["backup", "restore"]);
  expect(matchRanges("backup", "back backup")).toEqual([{ start: 0, end: 6 }]);
});
let output: string;
const pages = new Map<string, { ids: Set<string>; links: string[]; html: string }>();
beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), "vyline-site-test-"));
  const build = Bun.spawn([process.execPath, join(root, "scripts/build-landing.ts"), output], {
    cwd: tmpdir(),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await build.exited).toBe(0);
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".html")) {
        const html = await readFile(path, "utf8");
        pages.set(path, {
          html,
          ids: new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])),
          links: [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) =>
            match[1].replaceAll("&amp;", "&"),
          ),
        });
      }
    }
  }
  await walk(output);
});
afterAll(async () => {
  await rm(output, { recursive: true, force: true });
});

test("publishes the unified entry points and all registered source articles", async () => {
  for (const path of [
    "index.html",
    "install/index.html",
    "docs/index.html",
    "wiki/index.html",
    "status/index.html",
    "blog/index.html",
    "links/index.html",
  ])
    expect(pages.has(join(output, path))).toBe(true);
  const index = await Bun.file(join(output, "search.json")).json();
  expect(pages.get(join(output, "blog/index.html"))!.html).toContain('href="/vyline/blog/write/"');
  for (const item of index) {
    const path = item.url.slice("/vyline/".length);
    expect(pages.has(join(output, path.endsWith("/") ? `${path}index.html` : path))).toBe(true);
    expect(item.content.length).toBeGreaterThan(40);
  }
  expect(new Set(index.map((item: { section: string }) => item.section))).toEqual(
    new Set(["install", "docs", "wiki"]),
  );
});

test("every generated internal destination and fragment resolves", async () => {
  const failures = [];
  for (const [source, page] of pages)
    for (const link of page.links) {
      const url = new URL(link, `https://local.test/vyline/${source.slice(output.length + 1)}`);
      if (url.origin !== "https://local.test") continue;
      const path = decodeURIComponent(url.pathname).replace(/^\/vyline\//, "");
      const target = join(output, !path || path.endsWith("/") ? `${path}index.html` : path);
      if (!(await Bun.file(target).exists())) failures.push(`${source}: ${link}`);
      else if (
        url.hash &&
        pages.has(target) &&
        !pages.get(target)!.ids.has(decodeURIComponent(url.hash.slice(1)))
      )
        failures.push(`${source}: ${link}`);
    }
  expect(failures).toEqual([]);
});

test("installation and navigation remain usable without JavaScript", () => {
  const install = pages.get(join(output, "install/index.html"))!.html;
  for (const platform of ["bun", "windows", "linux", "macos", "docker"]) {
    expect(install).toContain(`id="${platform}"`);
    expect(install).toContain(`href="#${platform}"`);
  }
  expect(install).not.toContain('class="platform-panel" hidden');
  expect(install).toContain('<a href="#platforms">環境を選ぶ</a>');
  expect(install).not.toContain('<a href="#bun">環境を選ぶ</a>');
  for (const { html } of pages.values()) {
    if (html.includes('<aside class="toc">'))
      expect(html.match(/class="mobile-toc"/g)?.length).toBe(1);
    expect(html).toContain('<details class="mobile-nav">');
    expect(html).toContain('href="#main"');
    expect(html).toContain("CC BY 4.0");
  }
});

test("a build cannot overwrite repository source", async () => {
  const build = Bun.spawn(
    [process.execPath, join(root, "scripts/build-landing.ts"), join(root, "docs")],
    { cwd: tmpdir(), stdout: "pipe", stderr: "pipe" },
  );
  expect(await build.exited).not.toBe(0);
  expect(await new Response(build.stderr).text()).toContain(
    "Refusing to build into source directories",
  );
});
