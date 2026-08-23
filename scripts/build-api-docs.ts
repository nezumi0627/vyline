/**
 * scripts/build-api-docs.ts — GitHub Pages 用 API ドキュメント生成
 *
 * 出力先: <outdir>/
 *   index.html     Swagger UI（2 spec 切替）
 *   openapi.json   BFF (/line) spec — openapi.line.ts から生成
 *   openapi.yaml   公開 REST API (/v1) spec — リポジトリルートからコピー
 */

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lineOpenApiSpec } from "../Vyline/backend/src/api/openapi.line.js";

const outDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "dist-api-docs");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await mkdir(outDir, { recursive: true });
await Bun.write(join(outDir, "openapi.json"), JSON.stringify(lineOpenApiSpec, null, 2));
await copyFile(join(root, "openapi.yaml"), join(outDir, "openapi.yaml"));
await Bun.write(
  join(outDir, "index.html"),
  `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>Vyline API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js" crossorigin></script>
  </head>
  <body>
    <div id="swagger"></div>
    <script>
      window.onload = () =>
        SwaggerUIBundle({
          urls: [
            { name: "Public API (/v1)", url: "openapi.yaml" },
            { name: "BFF API (/line)", url: "openapi.json" },
          ],
          "urls.primaryName": "Public API (/v1)",
          dom_id: "#swagger",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: "StandaloneLayout",
        });
    </script>
  </body>
</html>
`,
);
console.log(`API docs generated at ${outDir}`);
