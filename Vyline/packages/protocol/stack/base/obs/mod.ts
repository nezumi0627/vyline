import { Buffer } from "node:buffer";
import { type BaseClient, InternalError } from "../core/mod.js";
import { MimeType } from "./mime.js";
import crypto from "node:crypto";
import type { Message } from "@vyline/line-types";
import { writeStruct } from "../thrift/readwrite/write.js";
// @ts-types="thrift-types"
import * as thrift from "thrift";

export type ObjType = "image" | "gif" | "video" | "audio" | "file";
export interface ObsMetadata {
  status: string;
  name: string;
  mime: string;
  type: string;
  hash: string;
  cksum: string;
  size: number | string;
  ctimeMillis: number;
  imageDetails?: {
    format: string;
    height: number;
    width: number;
    signature: string;
  };
  videoMp4Details?: {
    size: number;
    durationMillis: number;
    height: number;
    width: number;
    format: string;
    status: string;
  };
  audioM4aDetails?: {
    size: number;
    durationMillis: number;
    format: string;
    status: string;
  };
  svc: string;
  offset: number;
  ctime: string;
  oid: string;
  userid: string;
  sid: string;
}

export class LineObs {
  client: BaseClient;
  // リージョン別エンドポイント（JP アカウントは obs-jp。アルバム(GID)付与はリージョン側で行われる）
  prefix = process.env.VYLINE_OBS_PREFIX ?? "https://obs-jp.line-apps.com/";
  constructor(client: BaseClient) {
    this.client = client;
  }

  /**
   * Gets a message image URI by appending the given message ID to the prefixSticker
   * @param {string} [messageId] - The message ID to use in the URLSticker
   * @param {boolean} [isPreview=false] - Whether to append '/preview' to the URL.
   * @return {string} The getted message image
   */
  public getMessageDataUrl(
    messageId: string,
    isPreview: boolean = false,
    square: boolean = false,
  ): string {
    return `${this.prefix}r/${square ? "g2" : "talk"}/m/${messageId}${isPreview ? "/preview" : ""}`;
  }

  /**
   * Gets a message image URI by appending the given message ID to the prefixSticker
   * @param {string} [messageId] - The message ID to use in the URLSticker
   * @return {string} The getted message image
   */
  public getMessageMetadataUrl(messageId: string, square: boolean = false): string {
    return `${this.prefix}r/${square ? "g2" : "talk"}/m/${messageId}/object_info.obs`;
  }

  /**
   * @description Gets the message's data from LINE Obs.
   */
  public async downloadMessageData(options: {
    messageId: string;
    isPreview?: boolean;
    isSquare?: boolean;
  }): Promise<File> {
    if (!this.client.authToken) {
      throw new InternalError("Not setup yet", "Please call 'login()' first");
    }
    const { messageId, isPreview, isSquare } = {
      isPreview: false,
      isSquare: false,
      ...options,
    };
    const blob = await (
      await this.client.fetch(this.getMessageDataUrl(messageId, isPreview, isSquare), {
        headers: {
          accept: "application/json, text/plain, */*",
          "x-line-application": this.client.request.systemType,
          "x-Line-access": this.client.authToken,
        },
      })
    ).blob();
    const fileInfo = await this.getMessageObsMetadata({
      messageId,
      isSquare,
    });
    return new File([blob], fileInfo.name, { type: blob.type });
  }

  /**
   * @description Gets the message's data from LINE Obs.
   */
  public async getMessageObsMetadata(options: {
    messageId: string;
    isSquare?: boolean;
  }): Promise<ObsMetadata> {
    if (!this.client.authToken) {
      throw new InternalError("Not setup yet", "Please call 'login()' first");
    }
    const { messageId, isSquare } = {
      isSquare: false,
      ...options,
    };
    const r = await this.client.fetch(this.getMessageMetadataUrl(messageId, isSquare), {
      headers: {
        accept: "application/json, text/plain, */*",
        "x-line-application": this.client.request.systemType,
        "x-Line-access": this.client.authToken,
      },
    });
    return r.json();
  }

  /**
   * @description Upload obs message to talk.
   */
  public async uploadObjTalk(
    to: string,
    type: ObjType,
    data: Blob,
    oid?: string,
    filename?: string,
    durationMs?: number,
    reqseqOverride?: number,
  ): Promise<{
    objId: string;
    objHash: string;
    headers: Headers;
  }> {
    if (!this.client.authToken) {
      throw new InternalError("Not setup yet", "Please call 'login()' first");
    }
    const ext = MimeType[data.type as keyof typeof MimeType];
    const reqseqValue = oid ? undefined : (reqseqOverride ?? (await this.client.getReqseq("talk")));
    const param: {
      oid: string;
      reqseq?: string;
      tomid?: string;
      ver: string;
      name: string;
      type: string;
      cat?: string;
      duration?: string;
    } = {
      ver: "2.0",
      name: filename || "vyline." + ext,
      type,
      ...(oid
        ? { oid: oid }
        : {
            oid: "reqseq",
            tomid: to,
            reqseq: reqseqValue.toString(),
          }),
    };
    if (type === "image") {
      param.cat = "original";
    } else if (type === "gif") {
      param.cat = "original";
      param.type = "image";
    } else if (type === "audio" || type === "video") {
      // LINE uses this obs param verbatim as the displayed length (it does not
      // recompute it from the uploaded file), so a caller-supplied real duration
      // must be honoured; keep the historical value as the fallback.
      param.duration = (durationMs ?? 1919).toString();
    }
    const toType: "talk" | "g2" = to[0] === "m" || to[0] === "t" ? "g2" : "talk";
    return await this.uploadObjectForService({
      data,
      oType: type,
      obsPath: `${toType}/m/${oid ?? "reqseq"}`,
      filename: param.name,
      params: param,
    });
  }

  public async uploadObjTalkBatch(
    to: string,
    items: Array<{
      type: ObjType;
      data: Blob;
      filename?: string;
      durationMs?: number;
    }>,
  ): Promise<Array<{ objId: string; objHash: string; headers: Headers } | { error: unknown }>> {
    if (!items.length) return [];
    const reqseqs = await this.client.getReqseqs("talk", items.length);
    // 順次アップロード。失敗は結果に記録し、成功済み分を保持する
    //（Promise.all だと 1 失敗で全体が throw され、部分成功が分からなくなる）
    const out: Array<{ objId: string; objHash: string; headers: Headers } | { error: unknown }> = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      try {
        out.push(
          await this.uploadObjTalk(
            to,
            item.type,
            item.data,
            undefined,
            item.filename,
            item.durationMs,
            reqseqs[index],
          ),
        );
      } catch (error) {
        out.push({ error });
      }
    }
    return out;
  }

  public async uploadObjTalkMessage(options: {
    to: string;
    type: ObjType;
    data: Blob;
    filename?: string;
    durationMs?: number;
    relatedMessageId?: string;
    messageRelationType?: "FORWARD" | "AUTO_REPLY" | "SUBORDINATE" | "REPLY";
  }): Promise<Message> {
    const {
      to,
      type,
      data,
      filename,
      durationMs,
      relatedMessageId,
      messageRelationType,
    } = options;
    const ext = MimeType[data.type as keyof typeof MimeType];
    const typeSet: {
      image: [string, 1];
      video: [string, 2];
      audio: [string, 3];
      file: [string, 14];
      gif: [string, 1];
    } = {
      image: ["emi", 1],
      video: ["emv", 2],
      audio: ["ema", 3],
      file: ["emf", 14],
      gif: ["emi", 1],
    };
    const [obsNamespace, contentType] = typeSet[type];
    const params: Record<string, string> = { type: "file" };
    if (type === "image" || type === "gif") {
      params["cat"] = "original";
    }
    if (type === "gif") {
      params["type"] = "image";
    }
    if (type === "audio" || type === "video") {
      params["duration"] = (durationMs ?? 1919).toString();
    }
    const toType: "talk" | "g2" = to[0] === "m" || to[0] === "t" ? "g2" : "talk";
    const oid = crypto.randomUUID();
    const { objId } = await this.uploadObjectForService({
      data,
      oType: type,
      obsPath: `${toType}/m/${oid}`,
      params: {
        ...params,
        ver: "2.0",
        name: filename || `vyline.${ext}`,
      },
    });

    return await this.client.talk.sendMessage({
      to,
      contentType,
      contentMetadata: {
        SID: obsNamespace,
        OID: objId,
        FILE_SIZE: data.size.toString(),
        fileName: filename || `line.${ext}`,
        ...(type === "image" || type === "gif" || type === "video"
          ? {
              MEDIA_CONTENT_INFO: JSON.stringify({
                category: "original",
                fileSize: data.size,
                extension: ext,
                animated: type === "gif",
              }),
            }
          : {}),
      },
      relatedMessageId,
      messageRelationType: relatedMessageId ? messageRelationType : undefined,
    });
  }

  async uploadObjectForService(options: {
    data: Blob;
    oType?: ObjType;
    obsPath?: string;
    params?: Record<string, string | undefined>;
    filename?: string;
    addHeaders?: Record<string, string>;
  }): Promise<{ objId: string; objHash: string; headers: Headers }> {
    this.client.log("Obs.uploadObjectForService", options);
    let { data, oType, obsPath, params, filename, addHeaders } = {
      oType: "image",
      obsPath: "myhome/h",
      ...options,
    };
    const obsPathFinal = `/r/${obsPath}`;
    oType = oType.toLowerCase();

    filename = filename || crypto.randomUUID();
    const baseParams = {
      type: oType,
      ver: "2.0",
      name: filename,
    };

    params = { ...baseParams, ...(params || {}) };

    if (!data || data.size === 0) {
      throw new InternalError("ObsError", "No data to send.");
    }
    let headers: Record<string, string> = this.client.request.getHeader("POST");
    headers["content-type"] = "application/octet-stream";
    headers["X-Obs-Params"] = Buffer.from(JSON.stringify(params)).toString("base64");

    if (addHeaders) {
      headers = { ...headers, ...addHeaders };
    }

    const response = await this.client.fetch(this.prefix + obsPathFinal, {
      method: "POST",
      headers,
      body: data,
    });

    const objId = response.headers.get("x-obs-oid") ?? "";
    const objHash = response.headers.get("x-obs-hash") ?? "";
    this.client.log("Obs.uploadObjectForServiceResponse", {
      objId,
      objHash,
      headers: response.headers.toString(),
    });

    return { objId, objHash, headers: response.headers };
  }

  async downloadObjectForService(options: {
    obsPath: string;
    oid: string;
    addHeaders?: Record<string, string>;
  }): Promise<Blob> {
    let { obsPath, oid, addHeaders } = {
      addHeaders: {},
      ...options,
    };
    if (obsPath.includes("{oid}")) {
      obsPath = obsPath.replace("{oid}", oid);
    } else {
      obsPath += "/" + oid;
    }
    let headers: Record<string, string> = this.client.request.getHeader("GET");
    headers = { ...headers, ...addHeaders };

    const obsPathFinal = "r/" + obsPath;
    const response = await this.client.fetch(this.prefix + obsPathFinal, {
      method: "GET",
      headers,
    });
    return response.blob();
  }

  public async uploadMediaByE2EE(options: {
    data: Blob;
    oType: ObjType;
    to: string;
    filename?: string;
    /** Optional thumbnail; encrypted with the same keyMaterial. #103. */
    preview?: Blob;
    relatedMessageId?: string;
    messageRelationType?: "FORWARD" | "AUTO_REPLY" | "SUBORDINATE" | "REPLY";
  }): Promise<Message> {
    const { data, oType, to, filename, preview, relatedMessageId, messageRelationType } = options;
    const typeSet: {
      image: [string, 1];
      video: [string, 2];
      audio: [string, 3];
      file: [string, 14];
      gif: [string, 1];
    } = {
      image: ["emi", 1],
      video: ["emv", 2],
      audio: ["ema", 3],
      file: ["emf", 14],
      gif: ["emi", 1],
    };

    const ext = (filename && filename.split(".").at(-1)) || MimeType[data.type];

    const serviceName = "talk";
    const [obsNamespace, contentType] = typeSet[oType];
    const params: Record<string, string> = { type: "file" };

    if (oType === "gif") {
      params["cat"] = "original";
    }
    if (!(to[0] === "u" || to[0] === "c")) {
      throw new InternalError("ObsError", "Invalid mid");
    }
    const rawData = Buffer.from(await data.arrayBuffer());
    const { keyMaterial, encryptedData } = await this.client.e2ee.encryptByKeyMaterial(rawData);
    const tempId = "reqid-" + crypto.randomUUID();
    // @ts-expect-error: will fix cuz typescript version change
    const edata = new Blob([encryptedData]);
    const { objId } = await this.uploadObjectForService({
      data: edata,
      oType: "file",
      obsPath: `${serviceName}/${obsNamespace}/${tempId}`,
      params,
    });
    if (oType === "image" || oType === "gif" || oType === "video") {
      let previewEdata: Blob;
      if (preview) {
        const enc = await this.client.e2ee.encryptByKeyMaterial(
          Buffer.from(await preview.arrayBuffer()),
          Buffer.from(keyMaterial, "base64"),
        );
        // @ts-expect-error: Buffer is a valid BlobPart at runtime
        previewEdata = new Blob([enc.encryptedData]);
      } else {
        previewEdata = edata;
      }
      const { objId: objId2, headers } = await this.uploadObjectForService({
        data: previewEdata,
        oType: "file",
        obsPath: `${serviceName}/${obsNamespace}/${objId}__ud-preview`,
        params,
      });
      if (objId !== objId2) {
        throw new InternalError(
          "ObsError",
          "objId not match: " + JSON.stringify(Object.fromEntries(headers)),
          {
            headers: Object.fromEntries(headers),
          },
        );
      }
    }

    // E2EE メディアは E2EE チャンクを作る。peer が E2EE 非対応の場合は plain として送る
    // （データ自体は keyMaterial で暗号化済み。keyMaterial を metadata に載せるため、
    //  受信側が metadata の鍵から復号できる）
    let chunks: string[] | Buffer[];
    let e2ee = true;
    try {
      chunks = await this.client.e2ee.encryptE2EEMessage(
        to,
        { keyMaterial, fileName: filename || "line." + ext },
        contentType,
      );
    } catch (e) {
      if (
        e instanceof Error &&
        (e.name === "Not support E2EE" ||
          e.message?.startsWith("Not support E2EE") ||
          e.message.includes("E2EE_RETRY_PLAIN") ||
          e.message.includes("member settings off"))
      ) {
        e2ee = false;
        chunks = [];
      } else {
        throw e;
      }
    }

    return await this.client.talk.sendMessage({
      to,
      chunks,
      contentType: contentType,
      e2ee,
      contentMetadata: {
        SID: obsNamespace,
        OID: objId,
        FILE_SIZE: edata.size.toString(),
        keyMaterial,
        fileName: filename || `line.${ext}`,
        ...(e2ee ? { e2eeVersion: "2" } : {}),
        ...(oType === "image" || oType === "gif" || oType === "video"
          ? {
              MEDIA_CONTENT_INFO: JSON.stringify({
                category: "original",
                fileSize: edata.size,
                extension: ext,
                animated: oType == "gif",
              }),
            }
          : {}),
      },
      relatedMessageId,
      messageRelationType: relatedMessageId ? messageRelationType : undefined,
    });
  }

  public async downloadMediaByE2EE(message: Message): Promise<File | null> {
    if (!(message.to[0] === "u" || message.to[0] === "c")) {
      throw new InternalError("ObsError", "Invalid mid");
    }
    const { id, contentMetadata } = message;
    const meta = (contentMetadata ?? {}) as Record<string, unknown>;
    // Desktop 準拠: メディア鍵は contentMetadata.keyMaterial に平文で載ることが多い
    // （自送信メッセージは chunks を持たないため、平文 key があればそれを使う）
    let keyMaterial: string;
    let fileName: string;
    const plainKey = typeof meta.keyMaterial === "string" && meta.keyMaterial;
    if (plainKey) {
      keyMaterial = plainKey;
      fileName = typeof meta.fileName === "string" ? meta.fileName : "media";
    } else {
      const chunks = message.chunks ?? [];
      if (!chunks.length) return null;
      const dec = await this.client.e2ee.decryptE2EEDataMessage(message);
      keyMaterial = String(dec.keyMaterial ?? "");
      fileName = String(dec.fileName ?? "media");
    }
    const talkMeta = Buffer.from(
      JSON.stringify({
        message: Buffer.from(
          writeStruct(
            [
              [11, 4, id],
              [15, 27, [12, []]],
            ],
            thrift.TBinaryProtocol,
          ),
        ).toString("base64"),
      }),
    ).toString("base64");
    const data = await this.downloadObjectForService({
      oid: contentMetadata.OID,
      obsPath: "talk/" + contentMetadata.SID,
      addHeaders: { "X-Talk-Meta": talkMeta },
    });
    const fileData = new File(
      [
        // @ts-expect-error: will fix cuz typescript version change
        await this.client.e2ee.decryptByKeyMaterial(
          Buffer.from(await data.arrayBuffer()),
          keyMaterial,
        ),
      ],
      fileName,
    );
    return fileData;
  }
}
