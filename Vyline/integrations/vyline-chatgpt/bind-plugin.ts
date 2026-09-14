import { readFile, writeFile } from "node:fs/promises";

const pluginId = process.argv[2];
if (!pluginId || !/^plugin_asdk_app[_-][A-Za-z0-9_-]+$/.test(pluginId)) {
  throw new Error(
    "Pass the actual plugin_asdk_app... ID from the ChatGPT plugin URL after registration",
  );
}
const manifestUrl = new URL("./.codex-plugin/plugin.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
await writeFile(
  new URL("./.app.json", import.meta.url),
  `${JSON.stringify({ apps: { vyline: { id: pluginId } } }, null, 2)}\n`,
);
manifest.apps = "./.app.json";
await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Bound the skill package to the registered ChatGPT plugin.");
