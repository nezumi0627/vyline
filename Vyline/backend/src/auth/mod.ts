import { getClient } from "../line/clientManager.js";
import type { VylineClient } from "@vyline/protocol";

export class AuthService {
  /**
   * トークン更新を試みる。refreshToken が未保存（トークンからの復元等）でも
   * 失敗させない。実際のリフレッシュは request 層の MUST_REFRESH で行われる。
   */
  static async tryRefreshToken(accountId: string): Promise<void> {
    const client = getClient(accountId);
    if (!client) throw new Error(`not logged in: ${accountId}`);
    try {
      await client.base.auth.tryRefreshToken();
    } catch (err) {
      if (err instanceof Error && err.message.includes("refreshToken not found")) return;
      throw err;
    }
  }
}
