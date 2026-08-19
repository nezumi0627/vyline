/**
 * RPC 辞書 → Desktop 実体 → Vyline 実装 の対応表
 *
 * 方針:
 * 1. 正規のメソッド名（canonicalName）を「探し語」にする
 * 2. `bun run vyline:find-native -- <name> --list-only` で Desktop に同名 Thrift / C++ があるか確認
 * 3. Desktop で確定した path / RPC を実装の正とする
 *
 * 根拠ログ: source/desktop/recovered/native-search/
 */

export type RpcPath =
  | "/S4"
  | "/V4"
  | "/api/v3p/rs"
  | "/api/v3/TalkService.do"
  | "/LF1"
  | "OBS"
  | "LOCAL";

export interface RpcEntry {
  /** 正規のメソッド名（辞書キー） */
  canonicalName: string;
  /** Desktop unpacked_LINE.exe で観測された文字列（代表例） */
  desktopEvidence: string[];
  /** Thrift / HTTP パス（Desktop 準拠） */
  path: RpcPath;
  /** stack 内の実装 */
  stackApi: string;
  /** protocol domain facade（あれば） */
  domainApi?: string;
  /** backend service（あれば） */
  backendApi?: string;
  /** 機能カテゴリ */
  category:
    | "login"
    | "talk"
    | "profile"
    | "chat-admin"
    | "contacts"
    | "e2ee"
    | "obs"
    | "call"
    | "sync";
  notes?: string;
}

/**
 * 使用中 + 実装対象の RPC 一覧。
 * Desktop 検証日: 2026-07-29（findNativeSymbol --list-only）
 */
export const RPC_DICTIONARY: readonly RpcEntry[] = [
  // ── Login ──────────────────────────────────────────
  {
    canonicalName: "getRSAKeyInfo",
    desktopEvidence: ["getRSAKeyInfo", "TalkService.do"],
    path: "/api/v3/TalkService.do",
    stackApi: "base.loginProcess.getRSAKeyInfo",
    domainApi: "session.login",
    backendApi: "auth (email login)",
    category: "login",
    notes: "Desktop は v3。v4 は x-lc:400",
  },
  {
    canonicalName: "loginV2",
    desktopEvidence: ["loginV2"],
    path: "/api/v3p/rs",
    stackApi: "base.loginProcess (loginV2)",
    category: "login",
    notes: "DESKTOPWIN/MAC は v3p。ANDROIDSECONDARY は v4p 可",
  },
  {
    canonicalName: "confirmE2EELogin",
    desktopEvidence: ["confirmE2EELogin"],
    path: "/api/v3p/rs",
    stackApi: "base.loginProcess.confirmE2EELogin",
    category: "login",
  },
  {
    canonicalName: "qrCodeLoginV2ForSecure",
    desktopEvidence: [
      "createSession",
      "createQrCodeForSecure",
      "checkQrCodeVerified",
      "qrCodeLoginV2ForSecure",
    ],
    path: "/api/v3p/rs",
    stackApi: "base.loginProcess.qrCodeLoginV2ForSecure",
    category: "login",
  },

  // ── Talk ───────────────────────────────────────────
  {
    canonicalName: "sendMessage",
    desktopEvidence: ["TalkService_sendMessage_pargs", "line::SendMessageTask::sendMessage"],
    path: "/S4",
    stackApi: "base.talk.sendMessage",
    domainApi: "session.talk.sendText",
    backendApi: "sendMessage",
    category: "talk",
  },
  {
    canonicalName: "unsendMessage",
    desktopEvidence: [
      "TalkService_unsendMessage_pargs",
      "line::ChatServiceImpl::requestUnsendMessage",
    ],
    path: "/S4",
    stackApi: "base.talk.unsendMessage",
    domainApi: "session.talk.unsend",
    backendApi: "unsendMessage",
    category: "talk",
  },
  {
    canonicalName: "getPreviousMessagesV2WithRequest",
    desktopEvidence: ["TalkService_getPreviousMessagesV2WithRequest_pargs"],
    path: "/S4",
    stackApi: "base.talk.getPreviousMessagesV2WithRequest",
    domainApi: "session.talk.fetchMessages",
    backendApi: "fetchMessages",
    category: "talk",
  },
  {
    canonicalName: "getMessageBoxes",
    desktopEvidence: ["TalkService_getMessageBoxes_pargs"],
    path: "/S4",
    stackApi: "base.talk.getMessageBoxes",
    backendApi: "fetchChats / markAsRead",
    category: "talk",
  },
  {
    canonicalName: "sendChatChecked",
    desktopEvidence: ["TalkService_sendChatChecked_pargs"],
    path: "/S4",
    stackApi: "base.talk.sendChatChecked",
    backendApi: "markAsRead",
    category: "talk",
  },
  {
    canonicalName: "getMessageReadRange",
    desktopEvidence: ["TalkService_getMessageReadRange_pargs"],
    path: "/S4",
    stackApi: "base.talk.getMessageReadRange",
    backendApi: "getReadReceiptsForChat",
    category: "talk",
  },

  // ── Profile (self) ─────────────────────────────────
  {
    canonicalName: "getProfile",
    desktopEvidence: ["TalkService_getProfile_pargs", "TalkService_getProfile_presult"],
    path: "/S4",
    stackApi: "base.talk.getProfile",
    domainApi: "session.profile.getMine",
    backendApi: "fetchProfile",
    category: "profile",
  },
  {
    canonicalName: "updateProfileAttributes",
    desktopEvidence: [
      "TalkService_updateProfileAttributes_pargs",
      "ProfileService_updateProfileAttributes_pargs",
    ],
    path: "/S4",
    stackApi: "base.talk.updateProfileAttributes",
    domainApi: "session.profile.update",
    backendApi: "updateMyProfile",
    category: "profile",
  },

  // ── Chat admin ─────────────────────────────────────
  {
    canonicalName: "updateChat",
    desktopEvidence: [
      "TalkService_updateChat_pargs",
      "line::ChatMergeTask::updateChatOnAsyncThread",
    ],
    path: "/S4",
    stackApi: "base.talk.updateChat",
    domainApi: "session.chat.updateName / updatePicture",
    backendApi: "updateChat",
    category: "chat-admin",
    notes: "Pb1_O2: NAME | PICTURE_STATUS | …",
  },
  {
    canonicalName: "getChat",
    desktopEvidence: ["TalkService_getChats_pargs"],
    path: "/S4",
    stackApi: "base.talk.getChats → Client.getChat",
    domainApi: "session.chat.get",
    backendApi: "fetchContactProfile (c*/r*)",
    category: "chat-admin",
  },

  // ── Contacts (others) ──────────────────────────────
  {
    canonicalName: "getContactsV3",
    desktopEvidence: ["getContactsV3", "TalkService / Relation"],
    path: "/S4",
    stackApi: "base.relation.getContactsV3",
    domainApi: "session.contacts.get",
    backendApi: "fetchContactProfile (u*)",
    category: "contacts",
  },
  {
    canonicalName: "updateContactSetting",
    desktopEvidence: ["TalkService_updateContactSetting_pargs", "updateContactSetting"],
    path: "/S4",
    stackApi: "base.talk.updateContactSetting",
    domainApi: "session.contacts.rename",
    backendApi: "renameContact",
    category: "contacts",
    notes: "友だち表示名 override (CONTACT_SETTING_DISPLAY_NAME_OVERRIDE)",
  },

  // ── E2EE ───────────────────────────────────────────
  {
    canonicalName: "getE2EEPublicKeys",
    desktopEvidence: ["TalkService_getE2EEPublicKeys_pargs"],
    path: "/S4",
    stackApi: "base.talk.getE2EEPublicKeys",
    category: "e2ee",
  },
  {
    canonicalName: "getLastE2EEGroupSharedKey",
    desktopEvidence: ["TalkService_getLastE2EEGroupSharedKey_pargs"],
    path: "/S4",
    stackApi: "base.talk.getLastE2EEGroupSharedKey",
    category: "e2ee",
  },
  {
    canonicalName: "registerE2EEPublicKey",
    desktopEvidence: ["TalkService_registerE2EEPublicKey_pargs"],
    path: "/S4",
    stackApi: "base.talk.registerE2EEPublicKey",
    category: "e2ee",
  },

  // ── OBS ────────────────────────────────────────────
  {
    canonicalName: "uploadMediaByE2EE / uploadObjectForService",
    desktopEvidence: ["obs.line-apps.com"],
    path: "OBS",
    stackApi: "base.obs.uploadMediaByE2EE / uploadObjectForService",
    domainApi: "session.profile.uploadAvatar / session.chat.uploadPicture",
    backendApi: "sendMedia / updateMyProfileImage",
    category: "obs",
    notes: "Desktop 文字列はホスト名中心。メソッド名は Thrift ではなく HTTP OBS API",
  },
  {
    canonicalName: "downloadMediaByE2EE",
    desktopEvidence: ["obs.line-apps.com"],
    path: "OBS",
    stackApi: "base.obs.downloadMediaByE2EE",
    backendApi: "fetchMessageMedia",
    category: "obs",
  },

  // ── Call (UI はダミー維持) ─────────────────────────
  {
    canonicalName: "acquireCallRoute / acquireRoute",
    desktopEvidence: ["acquireCallRoute"],
    path: "/V4",
    stackApi: "base.call.acquireCallRoute → client.call.acquireRoute",
    backendApi: "acquireCallRoute",
    category: "call",
    notes: "CallOverlay UI は触らない方針。backend のみ残置",
  },
] as const;

export function findRpc(canonicalName: string): RpcEntry | undefined {
  const q = canonicalName.toLowerCase();
  return RPC_DICTIONARY.find(
    (e) =>
      e.canonicalName.toLowerCase() === q ||
      e.canonicalName.toLowerCase().includes(q) ||
      e.desktopEvidence.some((d) => d.toLowerCase().includes(q)),
  );
}

export function listRpcByCategory(category: RpcEntry["category"]): RpcEntry[] {
  return RPC_DICTIONARY.filter((e) => e.category === category);
}
