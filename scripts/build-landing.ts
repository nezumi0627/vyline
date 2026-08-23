/**
 * scripts/build-landing.ts — GitHub Pages 用ランディングページ生成
 *
 * Swagger UI は nezumi0627.github.io/vyline-api に移設済み。
 * 出力先: <outdir>/index.html
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "dist-landing");
await mkdir(outDir, { recursive: true });
await Bun.write(
  join(outDir, "index.html"),
  `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vyline</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #0f1115; color: #e6e6e6;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      main { text-align: center; padding: 2rem; }
      h1 { font-size: 2.5rem; margin: 0 0 .5rem; letter-spacing: .02em; }
      p  { color: #9aa0a6; margin: 0 0 2rem; }
      a.btn {
        display: inline-block; margin: 0 .5rem .5rem; padding: .7rem 1.4rem;
        border: 1px solid #3a3f4b; border-radius: 8px; text-decoration: none;
        color: #e6e6e6; transition: border-color .15s;
      }
      a.btn:hover { border-color: #85ea2d; }
    </style>
  </head>
  <body>
    <main>
      <h1>Vyline</h1>
      <p>Self-hosted third-party LINE client</p>
      <a class="btn" href="https://github.com/nezumi0627/vyline">GitHub</a>
      <a class="btn" href="https://nezumi0627.github.io/vyline-api/">API Docs (Swagger UI)</a>
    </main>
  </body>
</html>
`,
);
console.log(`Landing page generated at ${outDir}`);
