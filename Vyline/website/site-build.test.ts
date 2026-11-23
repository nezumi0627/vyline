import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
let output: string;
beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), "vyline-site-test-"));
  const child = Bun.spawn([process.execPath, join(root, "scripts/build-landing.ts"), output], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const errors = await new Response(child.stderr).text();
  expect(await child.exited, errors).toBe(0);
});
afterAll(async () => {
  if (output) await rm(output, { recursive: true });
});

test("publishes separate installation and technical documentation entry points", async () => {
  const home = await readFile(join(output, "index.html"), "utf8");
  const installation = await readFile(join(output, "install/index.html"), "utf8");
  const docs = await readFile(join(output, "docs/index.html"), "utf8");
  expect(home).not.toContain("product-window");
  expect(home).not.toContain("あなたの余白");
  expect(home).toContain('href="/vyline/install/"');
  expect(home).toContain('href="/vyline/docs/"');
  expect(installation).toContain('data-section="install"');
  expect(docs).toContain('data-section="docs"');
});

test("keeps installation articles out of the technical article tree", async () => {
  const architecture = await readFile(join(output, "guide/docs/architecture.html"), "utf8");
  const docker = await readFile(join(output, "guide/docs/install/docker.html"), "utf8");
  const tree = (html: string) =>
    html.match(/<aside class="article-sidebar"[\s\S]*?<\/aside>/)?.[0] ?? "";
  expect(tree(architecture)).toContain('aria-current="page"');
  expect(tree(architecture)).not.toContain("/guide/docs/install/docker.html");
  expect(tree(docker)).toContain("/guide/docs/install/windows.html");
  expect(tree(docker)).not.toContain("/guide/docs/architecture.html");
  expect(architecture).toContain('class="article-toc"');
  expect(architecture).toContain('class="architecture-map"');
});

test("search includes real article bodies and identifies their section", async () => {
  const index = JSON.parse(await readFile(join(output, "search.json"), "utf8"));
  const docker = index.find((doc: { path: string }) => doc.path === "docs/install/docker.md");
  expect(docker.section).toBe("install");
  expect(docker.content).toContain("VYLINE_IMAGE");
  expect(index.find((doc: { path: string }) => doc.path === "docs/architecture.md").section).toBe(
    "docs",
  );
});

test("introduction links stay inside the preview and do not promise a removed tour", async () => {
  const intro = await readFile(join(output, "guide/docs/start-here.html"), "utf8");
  expect(intro).not.toContain("操作できる導入ツアー");
  expect(intro).not.toContain('href="https://nezumi0627.github.io/vyline/');
  expect(intro).toContain('href="/vyline/install/"');
});

test("all generated local page and fragment links resolve", async () => {
  const pages = new Map<string, string>();
  for (const path of await readdir(output, { recursive: true })) {
    if (path.endsWith(".html"))
      pages.set(join(output, path), await readFile(join(output, path), "utf8"));
  }
  const missing: string[] = [];
  for (const [path, html] of pages) {
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (!href.startsWith("/vyline/") && !href.startsWith("#")) continue;
      const url = new URL(href, `https://example.com/vyline/${path.slice(output.length + 1)}`);
      let target = join(output, decodeURIComponent(url.pathname.slice("/vyline/".length)));
      try {
        if ((await stat(target)).isDirectory()) target = join(target, "index.html");
        await stat(target);
        const content = pages.get(target);
        if (
          url.hash &&
          content &&
          !content.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`)
        )
          missing.push(`${path}: ${href}`);
      } catch {
        missing.push(`${path}: ${href}`);
      }
    }
  }
  expect(missing).toEqual([]);
});
