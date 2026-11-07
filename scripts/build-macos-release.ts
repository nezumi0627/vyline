#!/usr/bin/env bun
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

if (process.platform !== "darwin") {
  throw new Error("macOS packages must be built on a macOS runner");
}

const root = resolve(import.meta.dir, "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
  version: string;
};
const arch = process.arch;
if (arch !== "arm64" && arch !== "x64") {
  throw new Error(`Unsupported macOS architecture: ${arch}`);
}
const releaseDir = join(root, "dist", "macos");
const packageName = `Vyline-macos-${arch}-${version}`;
const appDir = join(releaseDir, packageName, "Vyline.app");
const contentsDir = join(appDir, "Contents");
const macOSDir = join(contentsDir, "MacOS");
const resourcesDir = join(contentsDir, "Resources");
const webDir = join(resourcesDir, "web");

function run(command: string, args: string[]) {
  const result = Bun.spawnSync([command, ...args], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`${command} failed`);
}

await rm(join(releaseDir, packageName), { recursive: true, force: true });
await mkdir(macOSDir, { recursive: true });
await mkdir(webDir, { recursive: true });
const iconsetDir = join(resourcesDir, "Vyline.iconset");
await mkdir(iconsetDir, { recursive: true });
run("bun", ["run", "build"]);
await cp(join(root, "Vyline", "apps", "desktop", "dist"), webDir, { recursive: true });
await cp(join(root, "openapi.yaml"), join(resourcesDir, "openapi.yaml"));
const fallbackProfile = join(
  root,
  "Vyline",
  "packages",
  "protocol",
  "data",
  "desktop-profile.fallback.json",
);
await mkdir(join(resourcesDir, "data"), { recursive: true });
await cp(fallbackProfile, join(resourcesDir, "data", "desktop-profile.fallback.json"));

const logoDir = join(root, "logo", "assets", "color");
for (const [name, sourceSize, outputSize] of [
  ["icon_16x16.png", 64, 16],
  ["icon_16x16@2x.png", 64, 32],
  ["icon_32x32.png", 64, 32],
  ["icon_32x32@2x.png", 64, 64],
  ["icon_128x128.png", 128, 128],
  ["icon_128x128@2x.png", 256, 256],
  ["icon_256x256.png", 256, 256],
  ["icon_256x256@2x.png", 512, 512],
  ["icon_512x512.png", 512, 512],
  ["icon_512x512@2x.png", 1024, 1024],
] as const) {
  const source = join(logoDir, `${sourceSize}.png`);
  const destination = join(iconsetDir, name);
  if (sourceSize === outputSize) await cp(source, destination);
  else run("sips", ["-z", String(outputSize), String(outputSize), source, "--out", destination]);
}
run("iconutil", ["-c", "icns", iconsetDir, "-o", join(resourcesDir, "Vyline.icns")]);
await rm(iconsetDir, { recursive: true, force: true });

const target = `bun-darwin-${arch}`;
run("bun", [
  "build",
  "--compile",
  "--minify",
  `--target=${target}`,
  "--outfile",
  join(resourcesDir, "VylineBackend"),
  join(root, "Vyline", "backend", "src", "index.ts"),
]);
run("bun", [
  "build",
  "--compile",
  "--minify",
  `--target=${target}`,
  "--outfile",
  join(macOSDir, "Vyline"),
  join(root, "scripts", "macos-launcher.ts"),
]);

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Vyline</string>
<key>CFBundleDisplayName</key><string>Vyline</string>
<key>CFBundleIdentifier</key><string>com.nezumi0627.vyline</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>Vyline</string>
<key>CFBundleIconFile</key><string>Vyline.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
`;
await writeFile(join(contentsDir, "Info.plist"), plist);

// Bun's compiled Mach-O files can carry a linker-generated ad-hoc signature
// that is invalid for the final packaged app. Re-sign each executable and
// then seal the completed bundle after all resources and Info.plist are final.
const backendPath = join(resourcesDir, "VylineBackend");
const launcherPath = join(macOSDir, "Vyline");
for (const executable of [backendPath, launcherPath]) {
  run("codesign", ["--force", "--sign", "-", "--timestamp=none", executable]);
  run("codesign", ["--verify", "--strict", executable]);
}
run("codesign", ["--force", "--sign", "-", "--timestamp=none", appDir]);
run("codesign", ["--verify", "--strict", "--deep", appDir]);

run("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  join(releaseDir, packageName),
  join(releaseDir, `${packageName}.zip`),
]);
console.log(`Created ${join(releaseDir, `${packageName}.zip`)}`);
