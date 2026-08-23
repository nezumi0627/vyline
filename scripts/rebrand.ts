// Rebrand Nezu* → Vyline* across tracked source files.
// Run: bun scripts/rebrand.ts  (or bun run file)
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// --- ordered replacement map (longest / most specific first) ---
const map: Array<[RegExp | string, string]> = [
  // package name + subpath specifiers (exact, word-boundary guarded)
  [/@vyline\/nezuline-stack/g, "@vyline/protocol-stack"],
  [/@vyline\/nezuline(?=\/|"|')/g, "@vyline/protocol"],
  // classes / types
  [/NezuUpdaterOptions/g, "VylineUpdaterOptions"],
  [/NezuUpdater/g, "VylineUpdater"],
  [/NezuClient/g, "VylineClient"],
  [/NezuLoginInit/g, "VylineLoginInit"],
  [/NezuStorage/g, "VylineStorage"],
  [/NezuCacheDb/g, "VylineCacheDb"],
  [/NezuCache\b/g, "VylineCache"],
  [/NezuProfileLite/g, "VylineProfileLite"],
  [/NezuMemberLite/g, "VylineMemberLite"],
  [/NezuGroupLite/g, "VylineGroupLite"],
  [/NezuProfileInput/g, "VylineProfileInput"],
  [/NezuGroupInput/g, "VylineGroupInput"],
  [/NezuCachedProfile/g, "VylineCachedProfile"],
  [/NezuCachedGroup/g, "VylineCachedGroup"],
  [/NezuThemeTokens/g, "VyThemeTokens"],
  [/NezuThemeId/g, "VyThemeId"],
  [/NEZU_THEME_PRESETS/g, "VYLINE_THEME_PRESETS"],
  [/NezuThemePanel/g, "VyThemePanel"],
  [/NezuTheme/g, "VyTheme"],
  [/NezuClientProfile/g, "VylineClientProfile"],
  [/NezuClientDb/g, "VylineClientDb"],
  [/NezuMem/g, "VylineMem"],
  [/NezuPrivKeyScan/g, "VylinePrivKeyScan"],
  [/NezuE2eeScan3/g, "VylineE2eeScan3"],
  // backend cache functions
  [/nezuLoadCache/g, "vylineLoadCache"],
  [/nezuGetProfiles/g, "vylineGetProfiles"],
  [/nezuGetProfile/g, "vylineGetProfile"],
  [/nezuResolvedNameMap/g, "vylineResolvedNameMap"],
  [/nezuPutProfiles/g, "vylinePutProfiles"],
  [/nezuPutProfile/g, "vylinePutProfile"],
  [/nezuGroupNeedsRefresh/g, "vylineGroupNeedsRefresh"],
  [/nezuProfileNeedsRefresh/g, "vylineProfileNeedsRefresh"],
  [/nezuPutGroup/g, "vylinePutGroup"],
  [/nezuGetGroup/g, "vylineGetGroup"],
  [/nezuFlush/g, "vylineFlush"],
  // desktop client cache functions
  [/nezuClientLoad/g, "vylineClientLoad"],
  [/nezuClientSave/g, "vylineClientSave"],
  [/nezuClientPutMany/g, "vylineClientPutMany"],
  [/nezuClientPut/g, "vylineClientPut"],
  [/nezuClientToContactMap/g, "vylineClientToContactMap"],
  // bridge / login
  [/loadNezuProfileCache/g, "loadVylineProfileCache"],
  [/initNezuProfile/g, "initVylineProfile"],
  [/refreshNezuProfile/g, "refreshVylineProfile"],
  [/getNezuProfile/g, "getVylineProfile"],
  [/getNezuUpdater/g, "getVylineUpdater"],
  [/nezuLoginEmail/g, "vylineLoginEmail"],
  [/nezuLoginQR/g, "vylineLoginQR"],
  [/nezuLoginToken/g, "vylineLoginToken"],
  // internal E2EE patched names
  [/__nezuGroupKeyWipe/g, "__vylineGroupKeyWipe"],
  [/__nezuGroupKeyLookupPatchedV3/g, "__vylineGroupKeyLookupPatchedV3"],
  [/__nezuTryRegisterBlocked/g, "__vylineTryRegisterBlocked"],
  [/__nezuOriginalTryRegisterE2EEGroupKey/g, "__vylineOriginalTryRegisterE2EEGroupKey"],
  // data dirs / file names (path literals)
  [/data\/nezuline/g, "data/vyline"],
  [/data\/nezu-cache-/g, "data/vyline-cache-"],
  [/nezu-\$\{/g, "vyline-${"],
  // env vars
  [/NEZU_DISABLE_WATCH/g, "VYLINE_DISABLE_WATCH"],
  [/NEZU_DATA_DIR/g, "VYLINE_DESKTOP_DATA_DIR"],
  [/NEZU_LINE_ROOT/g, "VYLINE_LINE_ROOT"],
  [/VYLINE_NEZU_SAVE_MS/g, "VYLINE_CACHE_SAVE_MS"],
  [/VYLINE_NEZU_PROFILE_TTL_MS/g, "VYLINE_PROFILE_TTL_MS"],
  [/VYLINE_NEZU_GROUP_TTL_MS/g, "VYLINE_GROUP_TTL_MS"],
  // localStorage keys
  [/nezu-profile-cache:/g, "vyline-profile-cache:"],
  [/vyline:nezu-theme/g, "vyline:theme"],
  // http route segments
  [/\/nezu\/cache/g, "/vyline/cache"],
  [/\/nezu\/warm/g, "/vyline/warm"],
  [/\/debug\/nezu\//g, "/debug/vyline/"],
  // log channels / labels
  [/childLogger\("NezuCache"\)/g, 'childLogger("VylineCache")'],
  [/childLogger\("NezuStorage"\)/g, 'childLogger("VylineStorage")'],
  [/childLogger\("nezu"\)/g, 'childLogger("vyline")'],
  [/base\.log\("nezu:/g, 'base.log("vyline:'],
  [/\[nezu:delta\]/g, "[vyline:delta]"],
  [/nezuType/g, "vylineType"],
  [/"NezuCache warm failed"/g, '"VylineCache warm failed"'],
  [/NezuUpdater\/0\.1/g, "VylineUpdater/0.1"],
  [/NezuLINE/g, "Vyline"],
  [/NezuLine/g, "Vyline"],
  [/nezumi0627\/Vyline/g, "nezumi0627/Vyline"],
  // fallback for the package dir string (path literal)
  [/packages\/nezuline/g, "packages/protocol"],
  // remaining path/import literals
  [/nezu\/profileBridge\.js/g, "vyline/profileBridge.js"],
  [/nezuStorage\.js/g, "vylineStorage.js"],
  [/\.\.\/nezu\//g, "../vyline/"],
  [/"nezuline"/g, '"vyline"'],
  [/defaultNezuDataDir/g, "defaultVylineDataDir"],
  [/backendNezu/g, "backendVyline"],
  [/"nezu stack log"/g, '"vyline stack log"'],
  [/includes\("nezuline"\)/g, 'includes("protocol")'],
  [/nezu:call-test/g, "vyline:call-test"],
  [/nezu:delta/g, "vyline:delta"],
  [/nezu:find-native/g, "vyline:find-native"],
  [/nezu:focus-recovered/g, "vyline:focus-recovered"],
  [/nezu:unpack/g, "vyline:unpack"],
  [/nezu:extract-e2ee/g, "vyline:extract-e2ee"],
  [/nezu:decrypt-edb/g, "vyline:decrypt-edb"],
  [/nezu:dump-desktop/g, "vyline:dump-desktop"],
  [/Nezu ブランド/g, "Vyline ブランド"],
  [/NezuCache —/g, "VylineCache —"],
  [/NezuCache プロフィール/g, "VylineCache プロフィール"],
  // remaining function / API names
  [/nezuDownloadObs/g, "vylineDownloadObs"],
  [/lineProfileFromNezu/g, "lineProfileFromVyline"],
  [/applyNezuCacheToChats/g, "applyVylineCacheToChats"],
  [/nezuProfileCachePath/g, "vylineProfileCachePath"],
  [/nezuHit/g, "vylineHit"],
  [/nezuCache: /g, "vylineCache: "],
  [/nezuWarm/g, "vylineWarm"],
  [/\/nezu\/profile/g, "/vyline/profile"],
  [/\/nezu\/status/g, "/vyline/status"],
  [/\/nezu\/refresh/g, "/vyline/refresh"],
  [/Nezu profile refreshed/g, "Vyline profile refreshed"],
  [/Nezu ディスク/g, "Vyline ディスク"],
  [/Nezu クライアント側キャッシュ/g, "Vyline クライアント側キャッシュ"],
  [/Nezu 優先/g, "Vyline 優先"],
  [/Nezu ディスクキャッシュ/g, "Vyline ディスクキャッシュ"],
  [/NezuCache にも/g, "VylineCache にも"],
  [/Nezu から/g, "Vyline から"],
  [/nezuline\/e2ee/g, "protocol/e2ee"],
  [/nezuline の/g, "protocol の"],
  [/nezuline 内部/g, "protocol 内部"],
  [/([^@a-z])nezuline([^a-z])/g, "$1protocol$2"],
  // remaining file-path imports
  [/\.\.\/lib\/nezu-cache/g, "../lib/vyline-cache"],
  [/"@\/components\/nezu-theme-panel/g, '"@/components/vyline-theme-panel'],
  [/nezu-cache\.js/g, "vyline-cache.js"],
  [/nezu-cache"/g, "vyline-cache"],
  [/\.\.\/storage\/nezuCache\.js/g, "../storage/vylineCache.js"],
  [/base\.log\("nezu:group-e2ee"/g, 'base.log("vyline:group-e2ee"'],
];

// Files to process = git-tracked, code/docs only (skip lockfile which we regenerate via bun install)
const tracked = execSync("git ls-files", { cwd: "E:/projects/Vyline", encoding: "utf8" })
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const untracked = execSync("git ls-files --others --exclude-standard", {
  cwd: "E:/projects/Vyline",
  encoding: "utf8",
})
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((f) => f.startsWith("Vyline/") && /\.(ts|tsx|js|mjs|cjs|json|md)$/.test(f));
const all = [...tracked, ...untracked].filter((f) => {
  if (f.includes(".claude/skills/nezu-md")) return false; // keep the nezu-md skill brand
  if (f.includes(".cursor/")) return false;
  if (f.endsWith(".har")) return false;
  if (f.includes("/source/") || f.startsWith("source/")) return false;
  if (f.includes("research/")) return false;
  if (f === "bun.lock") return false;
  if (f.includes("/node_modules/")) return false;
  if (f.includes("/data/")) return false;
  return true;
});

let touched = 0;
for (const file of all) {
  const abs = `E:/projects/Vyline/${file}`;
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    continue; // file no longer exists (already renamed/moved)
  }
  let changed = false;
  for (const [pat, repl] of map) {
    const next =
      typeof pat === "string" ? content.split(pat).join(repl) : content.replace(pat, repl);
    if (next !== content) changed = true;
    content = next;
  }
  if (changed) {
    writeFileSync(abs, content);
    touched++;
  }
}
console.log(`touched ${touched} files`);
