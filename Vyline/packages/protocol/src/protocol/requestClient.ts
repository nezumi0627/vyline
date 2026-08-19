/**
 * VylineRequestClient — LINE Legy API 向け自前 HTTP + Thrift トランスポート
 *
 * プロトコルスタックの `BaseClient.request` (RequestClient) と同じインターフェース
 * (`request(fields, methodName, protocolType, resultType, path, headers?)`)
 * を実装し、既存の呼び出し側 (patchLogin.ts などが既に生の thrift フィールド
 * 配列を組み立てているコード) をそのまま流用できるようにする。
 *
 * Wire フォーマットは Apache Thrift の公開仕様 (Binary / Compact Protocol)
 * であり、`../protocol/thrift.ts` の自前実装で エンコード/デコードする。
 */

import { decodeThrift, encodeThrift, type DecodedStruct, type ThriftField } from "./thrift.js";

export interface RequestClientOptions {
  endpoint: string;
  userAgent: string;
  /** x-line-application ヘッダ値 (TAB区切り: APP\tVER\tOS\tOSVER) */
  systemType: string;
  authToken?: string;
  extraHeaders?: Record<string, string>;
}

export class LineApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly raw?: DecodedStruct,
  ) {
    super(message);
    this.name = "LineApiError";
  }
}

/**
 * TalkException 等の LINE 例外 struct は概ね
 *   1: i32 code
 *   2: string message
 * の形をしている (実装によりフィールド追加あり)。code=0 は例外なしとみなす。
 */
function extractException(struct: DecodedStruct): LineApiError | null {
  const code = struct[1];
  const message = struct[2];
  if (code == null && message == null) return null;
  const codeNum = typeof code === "bigint" ? Number(code) : (code as number | undefined);
  if (codeNum === 0 || codeNum == null) {
    if (message == null) return null;
  }
  const msgStr = Buffer.isBuffer(message)
    ? message.toString("utf8")
    : String(message ?? "unknown error");
  return new LineApiError(msgStr, codeNum, struct);
}

export class VylineRequestClient {
  endpoint: string;
  userAgent: string;
  systemType: string;
  authToken?: string;
  extraHeaders: Record<string, string>;

  constructor(opts: RequestClientOptions) {
    this.endpoint = opts.endpoint;
    this.userAgent = opts.userAgent;
    this.systemType = opts.systemType;
    if (opts.authToken !== undefined) this.authToken = opts.authToken;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  getHeader(overrideMethod = "POST"): Record<string, string> {
    const header: Record<string, string> = {
      "user-agent": this.userAgent,
      "x-line-application": this.systemType,
      "content-type": "application/x-thrift",
      "accept-encoding": "gzip",
      "x-lal": "ja_JP",
      "x-lpv": "1",
      ...this.extraHeaders,
    };
    if (this.authToken) header["x-line-access"] = this.authToken;
    if (overrideMethod && overrideMethod !== "POST")
      header["x-http-method-override"] = overrideMethod;
    return header;
  }

  /**
   * @param fields thrift フィールド配列 (引数 struct の中身)
   * @param methodName x-line-method-name ヘッダ用のメソッド名
   * @param protocolType 3 = Binary, 4 = Compact
   * @param resultType false なら raw DecodedStruct をそのまま返す。
   *   文字列を渡した場合は将来の型付きデコード用フック (現状は無視して raw を返す)。
   * @param path HTTP パス (例: "/S4", "/api/v3p/rs")
   * @param headers 追加ヘッダ
   */
  async request(
    fields: ThriftField[],
    methodName: string,
    protocolType: number,
    _resultType: string | false,
    path: string,
    headers?: Record<string, string>,
  ): Promise<DecodedStruct> {
    const body = encodeThrift(fields, protocolType);
    const url = `https://${this.endpoint}${path}`;
    const finalHeaders: Record<string, string> = {
      ...this.getHeader("POST"),
      "x-line-method-name": methodName,
      ...headers,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: finalHeaders,
      body: new Uint8Array(body),
    });

    const buf = Buffer.from(await res.arrayBuffer());

    if (res.status === 403) {
      throw new LineApiError(`AUTHENTICATION_FAILED (status=403) [${methodName}]`, 403);
    }
    if (!res.ok && buf.length === 0) {
      throw new LineApiError(`HTTP ${res.status} for ${methodName} (${path})`, res.status);
    }

    let decoded: DecodedStruct;
    try {
      decoded = decodeThrift(buf, protocolType);
    } catch (err) {
      if (!res.ok) {
        throw new LineApiError(`HTTP ${res.status} for ${methodName} (${path})`, res.status);
      }
      throw err;
    }

    // プロトコルスタック準拠: フィールド 1 = 例外 (TalkException 等)、フィールド 0 = 正常値
    const exceptionField = decoded[1];
    if (exceptionField && typeof exceptionField === "object" && !Buffer.isBuffer(exceptionField)) {
      const exc = extractException(exceptionField as DecodedStruct);
      if (exc) throw exc;
    }
    return decoded;
  }
}
