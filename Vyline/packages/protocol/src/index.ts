/**
 * @vyline/protocol — LINE 互換レイヤ + Desktop 追従 (VylineUpdater)
 *
 * 既定セッション: ANDROIDSECONDARY（公式 DESKTOPWIN と同時ログイン可）
 * Desktop 完全エミュ: VYLINE_DEVICE=DESKTOPWIN（公式 Desktop を蹴る）
 * Desktop の identity / E2EE 鍵の正はインストール済み LINE.exe 側。
 *
 * 機能→ファイル地図: ./modules.map.ts
 * Desktop 差分 CLI:   ./tools/reportDesktopDelta.ts
 * 同時ログイン調査:   docs/analysis/dual-login-desktop.md
 */

// ── Types ──────────────────────────────────────────────
export type {
  DesktopProfile,
  DesktopIdentity,
  DetectResult,
  VylineUpdaterOptions,
  WatchHandle,
  WatchReason,
} from "./desktop/types.js";

export type { FeatureId, FeatureModule, FeatureDesktopHints } from "./modules.map.js";

export type { E2EEIdentityStatus } from "./login/ensureE2EE.js";
export type { DesktopE2EEKey, DesktopE2EEKeyDump } from "./login/importDesktopE2EE.js";
export type { VylineClient, VylineLoginInit } from "./client/VylineClient.js";
export type { DesktopPcIdentity } from "./login/pcIdentity.js";

// ── Domain facade (プロフィール / チャット管理 / 連絡先) ─
export {
  VylineSession,
  wrapSession,
  TalkDomain,
  ProfileDomain,
  ChatDomain,
  ContactsDomain,
  CallDomain,
} from "./domain/index.js";
export type {
  ProfileUpdateInput,
  ChatUpdateInput,
  ChatUpdateAttribute,
  ContactRenameInput,
} from "./domain/index.js";

// ── Call (transport 選択) ───────────────────────────────
export {
  pickCallTransport,
  pickCallTransportForClient,
  describeCallRoute,
  buildCallWireContext,
  buildDesktopPlanetUserAgent,
  type CallWireContext,
} from "./call/index.js";
export { RPC_DICTIONARY, findRpc, listRpcByCategory } from "./dictionary/index.js";
export type { RpcEntry, RpcPath } from "./dictionary/index.js";

// ── Protocol stack (Desktop 準拠 RPC / E2EE / OBS) ─────
export { Client } from "@vyline/protocol/stack";
export { BaseClient } from "@vyline/protocol/stack/base";
export type { BaseClient as VylineBaseClient } from "@vyline/protocol/stack/base";

// ── Desktop identity / detect ──────────────────────────
export {
  buildIdentity,
  buildDefaultHeaders,
  detectSystemVersion,
  detectNtSuffix,
  parseRuntimeApplicationHeader,
  parseRuntimeUserAgent,
} from "./desktop/identity.js";

export { detectInstalledDesktop } from "./desktop/version.js";
export { dumpRuntimeIdentity, extractFromExe } from "./desktop/extract.js";
export { defaultLineRoot, localAppData, UPDATE_INFO_URL } from "./desktop/paths.js";

// ── Updater ────────────────────────────────────────────
export { createVylineUpdater, VylineUpdater } from "./updater/VylineUpdater.js";

// ── Client / login ─────────────────────────────────────
export {
  loginWithEmail,
  loginWithQR,
  loginWithToken,
  sendText,
  applyDesktopHeaders,
  getDesktopPcIdentity,
  resolveDeviceMode,
  kicksOfficialDesktop,
  DEFAULT_DEVICE_MODE,
} from "./client/VylineClient.js";
export type { VylineDeviceMode } from "./client/VylineClient.js";

export { ensureValidE2EEIdentity } from "./login/ensureE2EE.js";
export {
  importDesktopE2EEKeys,
  loadDesktopE2EEKeyDump,
  defaultDesktopE2EEKeysPath,
} from "./login/importDesktopE2EE.js";
export {
  ensureGroupKeyById,
  prepareGroupKeysForMessages,
  groupKeyIdFromMessage,
  seedSelfPublicKeyCache,
  storeGroupKey,
  loadGroupKey,
  patchGroupKeyLookup,
  recreateE2EEGroupKey,
} from "./login/groupE2EE.js";
export type { GroupKeyMaterial } from "./login/groupE2EE.js";

export {
  DESKTOP_AUTH_RS,
  DESKTOP_TALK_RSA,
  DESKTOP_TALK_PATH,
  patchDesktopTransport,
} from "./login/patchTransport.js";

export { patchDesktopLogin } from "./login/patchLogin.js";

// ── E2EE / Letter Sealing (自前ポート) ──────────────────
export {
  LETTER_SEALING_CONTENT_TYPE,
  encryptLetterSealingMessage,
  encryptLetterSealingText,
  decryptLetterSealingMessage,
  prefetchDmPeerKeysForMessages,
  invalidatePeerPubCache,
  generateSharedSecret as letterSealingSharedSecret,
  generateAAD as letterSealingAAD,
  getSelfKeyByKeyId as letterSealingSelfKeyByKeyId,
  getSelfKeyByMid as letterSealingSelfKeyByMid,
} from "./e2ee/letterSealing.js";
export { selfPubCacheKey, peerPubCacheKey } from "./e2ee/pubCacheKeys.js";
export type {
  LetterSealingEnvelope,
  LetterSealingDecryptResult,
  SelfKeyData as LetterSealingSelfKeyData,
} from "./e2ee/letterSealing.js";

// ── OBS (protocol 置換) ──────────────────────────────────
export { downloadObsMessageBytes, obsMessageDataUrl } from "./obs/download.js";
export type { ObsDownloadDeps } from "./obs/download.js";

// ── Feature map (Desktop 更新時の調査ガイド) ───────────
export {
  FEATURE_IDS,
  MODULES_MAP,
  getFeatureModule,
  listFeatures,
  suggestedFeaturesOnDesktopUpdate,
} from "./modules.map.js";
