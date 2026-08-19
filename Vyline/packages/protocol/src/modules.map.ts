/**
 * FEATURE → Vyline ソース / Desktop 調査ヒントの対応表
 *
 * LINE Desktop 更新で壊れたとき、agents が「どこを見るか」を即決するための地図。
 * 詳細手順は docs/tools/desktop-delta.md を参照。
 */

export const FEATURE_IDS = [
  "login-qr",
  "login-email",
  "headers-transport",
  "e2ee-keys",
  "e2ee-send",
  "e2ee-decrypt",
  "talk-send",
  "profile-self",
  "profile-contacts",
  "chat-admin",
  "sync-events",
  "stickers",
  "calls",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export interface FeatureDesktopHints {
  /** %LOCALAPPDATA%\LINE 配下の相対パス、または絶対パスパターン */
  paths: string[];
  /** 検査対象バイナリ (バージョン付き bin 配下など) */
  binaries: string[];
  /** strings / メモリダンプ検索用キーワード */
  searchStrings: string[];
}

export interface FeatureModule {
  id: FeatureId;
  title: string;
  description: string;
  /** リポジトリルート相対の Vyline ソース */
  vylineFiles: string[];
  desktop: FeatureDesktopHints;
  /** docs/analysis/ ほか関連調査メモ */
  analysisDocs: string[];
  /** Desktop 更新時の再確認優先度 (高いほど先に見る) */
  priority: "high" | "medium" | "low";
}

/**
 * パスはリポジトリルート相対。
 * Desktop paths は %LOCALAPPDATA%\LINE を root とした相対、または明示プレースホルダ。
 */
export const MODULES_MAP: Record<FeatureId, FeatureModule> = {
  "login-qr": {
    id: "login-qr",
    title: "QR ログイン",
    description:
      "createSession → createQrCodeForSecure → checkQrCodeVerified → qrCodeLoginV2ForSecure",
    priority: "high",
    vylineFiles: [
      "Vyline/packages/protocol/src/login/patchLogin.ts",
      "Vyline/packages/protocol/src/login/pcIdentity.ts",
      "Vyline/packages/protocol/src/client/VylineClient.ts",
      "Vyline/backend/src/line/clientManager.ts",
      "Vyline/backend/src/api/auth.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe", "bin/update_log.txt", "Data/LINE.ini"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "createSession",
        "createQrCodeForSecure",
        "checkQrCodeVerified",
        "qrCodeLoginV2ForSecure",
        "/acct/lgn/sq/v1",
        "/acct/lp/lgn/sq/v1",
      ],
    },
    analysisDocs: ["docs/login-flow.md", "docs/analysis/login-qr.md"],
  },

  "login-email": {
    id: "login-email",
    title: "メールログイン (E2EE)",
    description: "getRSAKeyInfo → loginV2 → /LF1 → confirmE2EELogin → loginV2 (token)",
    priority: "high",
    vylineFiles: [
      "Vyline/packages/protocol/src/login/patchLogin.ts",
      "Vyline/packages/protocol/src/login/patchTransport.ts",
      "Vyline/packages/protocol/src/login/pcIdentity.ts",
      "Vyline/packages/protocol/src/client/VylineClient.ts",
      "Vyline/backend/src/line/clientManager.ts",
      "Vyline/backend/src/api/auth.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe", "Data/LINE.ini"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "getRSAKeyInfo",
        "loginV2",
        "confirmE2EELogin",
        "/api/v3/TalkService.do",
        "/api/v3p/rs",
        "/LF1",
        "e2eeData",
      ],
    },
    analysisDocs: ["docs/login-flow.md", "docs/analysis/login-email.md"],
  },

  "headers-transport": {
    id: "headers-transport",
    title: "ヘッダー / トランスポート",
    description: "UA / X-Line-Application (TAB) / Host / Talk・Auth パスの Desktop 互換",
    priority: "high",
    vylineFiles: [
      "Vyline/packages/protocol/src/login/patchTransport.ts",
      "Vyline/packages/protocol/src/desktop/identity.ts",
      "Vyline/packages/protocol/src/desktop/extract.ts",
      "Vyline/packages/protocol/src/desktop/version.ts",
      "Vyline/packages/protocol/src/updater/VylineUpdater.ts",
      "Vyline/backend/src/vyline/profileBridge.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe", "bin/update_log.txt", "Data/LINE.ini"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "DESKTOPWIN",
        "DESKTOP:WINDOWS",
        "x-line-application",
        "user-agent",
        "x-lap",
        "x-lpv",
        "legy-jp.line-apps.com",
        "/S4",
        "/api/v3p/rs",
      ],
    },
    analysisDocs: [
      "docs/login-flow.md",
      "docs/analysis/headers-transport.md",
      "docs/tools/desktop-delta.md",
    ],
  },

  "e2ee-keys": {
    id: "e2ee-keys",
    title: "E2EE 鍵管理",
    description: "Desktop keychain 取り込み・自己鍵検証・sender 鍵の整合",
    priority: "high",
    vylineFiles: [
      "Vyline/packages/protocol/src/login/ensureE2EE.ts",
      "Vyline/packages/protocol/src/login/importDesktopE2EE.ts",
      "Vyline/packages/protocol/src/login/patchLogin.ts",
      "Vyline/backend/src/api/debug.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe", "Data/"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "decodeE2EEKeyV1",
        "encryptedKeyChain",
        "negotiateE2EEPublicKey",
        "registerE2EEPublicKey",
        "e2eeKeys",
      ],
    },
    analysisDocs: ["docs/login-flow.md", "docs/analysis/e2ee-keys.md"],
  },

  "e2ee-send": {
    id: "e2ee-send",
    title: "E2EE 送信",
    description: "encryptE2EEMessage / E2EE_UPDATE_SENDER_KEY 時の鍵ローテート",
    priority: "high",
    vylineFiles: [
      "Vyline/packages/protocol/src/e2ee/letterSealing.ts",
      "Vyline/packages/protocol/src/login/ensureE2EE.ts",
      "Vyline/packages/protocol/src/client/VylineClient.ts",
      "Vyline/backend/src/service/lineService.ts",
      "Vyline/backend/src/api/line.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "encryptE2EEMessage",
        "sendMessage",
        "E2EE_UPDATE_SENDER_KEY",
        "negotiateE2EEPublicKey",
      ],
    },
    analysisDocs: [
      "docs/analysis/e2ee-send.md",
      "docs/login-flow.md",
      "source/desktop/recovered/src/native/sendMessage/README.md",
    ],
  },

  "e2ee-decrypt": {
    id: "e2ee-decrypt",
    title: "E2EE 復号",
    description: "decryptE2EEMessage / グループ鍵 / BAD_DECRYPT・履歴復号",
    priority: "high",
    vylineFiles: [
      "Vyline/packages/protocol/src/e2ee/letterSealing.ts",
      "Vyline/packages/protocol/src/login/ensureE2EE.ts",
      "Vyline/packages/protocol/src/login/importDesktopE2EE.ts",
      "Vyline/backend/src/service/lineService.ts",
      "Vyline/backend/src/api/debug.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe", "Data/"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "decryptE2EEMessage",
        "decryptE2EEDataMessage",
        "tryRegisterE2EEGroupKey",
        "BAD_DECRYPT",
      ],
    },
    analysisDocs: ["docs/analysis/e2ee-decrypt.md", "docs/login-flow.md"],
  },

  "talk-send": {
    id: "talk-send",
    title: "Talk 送信 (平文含む)",
    description: "TalkService /S4 sendMessage・unsend・既読",
    priority: "medium",
    vylineFiles: [
      "Vyline/packages/protocol/src/client/VylineClient.ts",
      "Vyline/packages/protocol/src/login/patchTransport.ts",
      "Vyline/backend/src/service/lineService.ts",
      "Vyline/backend/src/api/line.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe"],
      binaries: ["LINE.exe"],
      searchStrings: ["sendMessage", "unsendMessage", "/S4", "TalkService", "markAsRead"],
    },
    analysisDocs: ["docs/analysis/talk-send.md", "docs/login-flow.md"],
  },

  "profile-self": {
    id: "profile-self",
    title: "自分プロフィール",
    description: "getProfile / updateProfileAttributes / OBS プロフィール画像・背景",
    priority: "medium",
    vylineFiles: [
      "Vyline/packages/protocol/src/domain/profile.ts",
      "Vyline/packages/protocol/src/protocol/profileOps.ts",
      "Vyline/packages/protocol/src/dictionary/rpcMap.ts",
      "Vyline/backend/src/service/lineService.ts",
      "Vyline/backend/src/api/line.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "TalkService_getProfile",
        "TalkService_updateProfileAttributes",
        "ProfileService_updateProfileAttributes",
        "obs.line-apps.com",
      ],
    },
    analysisDocs: ["docs/analysis/avatar-profile-api.md", "docs/protocol/dictionary.md"],
  },

  "profile-contacts": {
    id: "profile-contacts",
    title: "他人プロフィール・友だち名",
    description: "getContactsV3 / updateContactSetting (表示名 override)",
    priority: "medium",
    vylineFiles: [
      "Vyline/packages/protocol/src/domain/contacts.ts",
      "Vyline/packages/protocol/stack/client/features/user/mod.ts",
      "Vyline/backend/src/service/lineService.ts",
      "Vyline/backend/src/api/line.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "getContactsV3",
        "updateContactSetting",
        "CONTACT_SETTING_DISPLAY_NAME_OVERRIDE",
      ],
    },
    analysisDocs: ["docs/analysis/avatar-profile-api.md", "docs/protocol/dictionary.md"],
  },

  "chat-admin": {
    id: "chat-admin",
    title: "グループ管理",
    description: "updateChat (NAME / PICTURE_STATUS) / uploadObjTalk",
    priority: "medium",
    vylineFiles: [
      "Vyline/packages/protocol/src/domain/chat.ts",
      "Vyline/packages/protocol/stack/client/features/chat/mod.ts",
      "Vyline/packages/protocol/stack/base/obs/mod.ts",
      "Vyline/backend/src/service/lineService.ts",
      "Vyline/backend/src/api/line.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "TalkService_updateChat",
        "updateChat",
        "PICTURE_STATUS",
        "obs.line-apps.com",
      ],
    },
    analysisDocs: ["docs/analysis/avatar-profile-api.md", "docs/protocol/dictionary.md"],
  },

  "sync-events": {
    id: "sync-events",
    title: "イベント同期",
    description: "fetchMyEvents /SQ1 long polling・リアルタイム受信",
    priority: "medium",
    vylineFiles: [
      "Vyline/backend/src/line/clientManager.ts",
      "Vyline/backend/src/service/lineService.ts",
      "Vyline/packages/protocol/src/login/patchTransport.ts",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe"],
      binaries: ["LINE.exe"],
      searchStrings: ["fetchMyEvents", "/SQ1", "sync", "long polling", "PushRecv"],
    },
    analysisDocs: ["docs/analysis/sync-events.md"],
  },

  stickers: {
    id: "stickers",
    title: "スタンプ",
    description: "スタンプ送信・メタデータ・コンテンツタイプ STICKER",
    priority: "low",
    vylineFiles: [
      "Vyline/backend/src/service/lineService.ts",
      "Vyline/apps/desktop/src/components/chat/MessageItem.tsx",
      "Vyline/apps/desktop/src/components/chat/MessageInput.tsx",
    ],
    desktop: {
      paths: ["bin/<version>/LINE.exe", "Data/"],
      binaries: ["LINE.exe"],
      searchStrings: ["STICKER", "sendMessage", "stickerId", "packageId", "Shop"],
    },
    analysisDocs: ["docs/analysis/stickers.md"],
  },

  calls: {
    id: "calls",
    title: "通話",
    description: "1:1 / グループ通話ルート取得 (acquireRoute)",
    priority: "low",
    vylineFiles: ["Vyline/backend/src/service/lineService.ts", "Vyline/backend/src/api/line.ts"],
    desktop: {
      paths: ["bin/<version>/LINE.exe"],
      binaries: ["LINE.exe"],
      searchStrings: [
        "acquireCallRoute",
        "acquireGroupCallRoute",
        "CallService",
        "voip",
        "mediaType",
      ],
    },
    analysisDocs: ["docs/analysis/calls.md"],
  },
};

export function getFeatureModule(id: FeatureId): FeatureModule {
  return MODULES_MAP[id];
}

export function listFeatures(): FeatureModule[] {
  return FEATURE_IDS.map((id) => MODULES_MAP[id]);
}

/** Desktop 更新時に優先して見直す機能 (priority 降順) */
export function suggestedFeaturesOnDesktopUpdate(): FeatureModule[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return listFeatures().sort((a, b) => rank[a.priority] - rank[b.priority]);
}
