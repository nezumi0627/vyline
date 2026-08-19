/**
 * Desktop トランスポート / ヘッダー恒常適用
 *
 * LINE.exe 実測 (HEX 0x09 = TAB):
 *   X-Line-Application: DESKTOPWIN\t{ver}\tWINDOWS\t{os}-{nt}
 *   User-Agent: DESKTOP:WINDOWS:{os}-{nt}({ver})
 *   X-LPV: 1 / x-lal: ja_JP / X-LAP: 5 (Legy 経路)
 * Host: legy-jp.line-apps.com
 */

import type { BaseClient } from "@vyline/protocol/stack/base";
import type { DesktopProfile } from "../desktop/types.js";

type RequestClientLike = {
  endpoint: string;
  userAgent: string;
  systemType: string;
  getHeader: (overrideMethod?: string) => Record<string, string>;
};

/**
 * Desktop パス方針 (registrationAuthEndpoint + 実リクエスト検証):
 * - Auth loginV2/confirmE2EELogin: /api/v3p/rs
 *   DESKTOPWIN/MAC は v3p。v4p は ANDROID/ANDROIDSECONDARY 向け。
 *   (LINE.exe メモリに v4p 文字列はあるが、Desktop email で使うと x-lc:400)
 * - getRSAKeyInfo: /api/v3/TalkService.do
 *   (/api/v4/TalkService.do はパス表にあるが getRSAKeyInfo では x-lc:400)
 * - Talk: /S4
 */
export const DESKTOP_AUTH_RS = "/api/v3p/rs";
export const DESKTOP_TALK_RSA = "/api/v3/TalkService.do";
export const DESKTOP_TALK_PATH = "/S4";

export function patchDesktopTransport(base: BaseClient, profile: DesktopProfile): void {
  const req = base.request as unknown as RequestClientLike;

  const host = profile.hosts.legy || "legy-jp.line-apps.com";
  req.endpoint = host;
  (base as { endpoint: string }).endpoint = host;

  req.userAgent = profile.identity.userAgent;
  req.systemType = profile.identity.xLineApplication;

  // deviceDetails も同期 (他経路のフォールバック防止)
  if (base.deviceDetails) {
    base.deviceDetails.appVersion = profile.identity.appVersion;
    base.deviceDetails.systemName = profile.identity.systemName;
    base.deviceDetails.systemVersion = `${profile.identity.systemVersion}-${profile.identity.ntSuffix}`;
  }

  const origGetHeader = req.getHeader.bind(req);
  req.getHeader = (overrideMethod = "POST") => {
    // 最新 profile 値を毎リクエスト再適用
    req.userAgent = profile.identity.userAgent;
    req.systemType = profile.identity.xLineApplication;

    const header = origGetHeader(overrideMethod);
    header["user-agent"] = profile.identity.userAgent;
    header["x-line-application"] = profile.identity.xLineApplication;
    header["x-lal"] = profile.defaultHeaders["x-lal"] ?? "ja_JP";
    header["x-lpv"] = profile.defaultHeaders["x-lpv"] ?? "1";
    // Desktop Legy 近傍で観測された X-LAP
    if (!header["x-lap"] && !header["X-LAP"]) {
      header["x-lap"] = "5";
    }
    return header;
  };
}
