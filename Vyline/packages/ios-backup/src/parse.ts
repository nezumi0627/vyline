import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseContentMetadata } from "./bplist.js";

export interface ChatInfo {
  chatMid: string;
  kind: "group" | "dm" | string;
  name: string | null;
  count: number;
  firstIso: string | null;
  lastIso: string | null;
  file: string;
}

export interface MessageRecord {
  id: number;
  ts: number;
  iso: string | null;
  contentType: number;
  sendStatus: number;
  fromMid: string | null;
  fromName: string;
  text: string | null;
  contentMetadata: unknown;
}

export interface ParsedChatHistory {
  account: string;
  exportedAt: string;
  chats: ChatInfo[];
  messages: Map<string, MessageRecord[]>;
}

export interface ParseOptions {
  lineDbPath: string;
  unifiedGroupDbPath: string;
  outputDir: string;
  myMid: string;
  onProgress?: (progress: ParseProgress) => void;
}

export interface ParseProgress {
  stage: "users" | "groups" | "chats" | "messages" | "writing" | "complete" | "error";
  current: number;
  total: number;
  message: string;
  chatMid?: string;
}

export function iosTimestampToIso(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

export async function parseLineDatabases(options: ParseOptions): Promise<ParsedChatHistory> {
  const { lineDbPath, unifiedGroupDbPath, outputDir, myMid, onProgress } = options;

  const lineDb = new Database(lineDbPath, { readonly: true });
  const ugDb = new Database(unifiedGroupDbPath, { readonly: true });

  try {
    onProgress?.({ stage: "users", current: 0, total: 5, message: "Loading users..." });

    const users = new Map<number, { mid: string; name: string }>();
    for (const row of lineDb
      .prepare("SELECT Z_PK, ZMID, ZNAME, ZCUSTOMNAME, ZADDRESSBOOKNAME FROM ZUSER")
      .iterate() as Iterable<{
      Z_PK: number;
      ZMID: string;
      ZNAME: string;
      ZCUSTOMNAME: string | null;
      ZADDRESSBOOKNAME: string | null;
    }>) {
      users.set(row.Z_PK, {
        mid: row.ZMID,
        name: row.ZCUSTOMNAME || row.ZADDRESSBOOKNAME || row.ZNAME || "Unknown",
      });
    }

    onProgress?.({ stage: "groups", current: 1, total: 5, message: "Loading group names..." });

    const groupNames = new Map<string, string>();
    for (const row of ugDb.prepare("SELECT ZID, ZNAME FROM ZUNIFIEDGROUP").iterate() as Iterable<{
      ZID: string | null;
      ZNAME: string;
    }>) {
      if (row.ZID) {
        groupNames.set(row.ZID.toLowerCase(), row.ZNAME);
      }
    }

    onProgress?.({ stage: "chats", current: 2, total: 5, message: "Loading chats..." });

    const chats = new Map<number, { chatMid: string; kind: string; name: string | null }>();
    for (const row of lineDb.prepare("SELECT Z_PK, ZMID, ZTYPE FROM ZCHAT").iterate() as Iterable<{
      Z_PK: number;
      ZMID: string | null;
      ZTYPE: number;
    }>) {
      const mid = (row.ZMID || "").toLowerCase();
      const kind = row.ZTYPE === 2 ? "group" : row.ZTYPE === 0 ? "dm" : `type${row.ZTYPE}`;
      chats.set(row.Z_PK, {
        chatMid: mid || `chat${row.Z_PK}`,
        kind,
        name: groupNames.get(mid) || null,
      });
    }

    onProgress?.({ stage: "messages", current: 3, total: 5, message: "Parsing messages..." });

    const messages = new Map<string, MessageRecord[]>();
    const chatInfos: ChatInfo[] = [];
    let totalMessages = 0;

    const chatRows = lineDb
      .prepare("SELECT Z_PK, ZMID, ZTYPE, ZLASTUPDATED FROM ZCHAT ORDER BY ZLASTUPDATED DESC")
      .all() as { Z_PK: number; ZMID: string | null; ZTYPE: number; ZLASTUPDATED: number }[];

    for (let i = 0; i < chatRows.length; i++) {
      const cr = chatRows[i];
      if (!cr) continue;
      const chat = chats.get(cr.Z_PK);
      if (!chat) continue;

      onProgress?.({
        stage: "messages",
        current: 3,
        total: 5,
        message: `Parsing ${chat.chatMid} (${i + 1}/${chatRows.length})`,
        chatMid: chat.chatMid,
      });

      const msgs = lineDb
        .prepare(
          `SELECT Z_PK, ZCONTENTTYPE, ZSENDSTATUS, ZTIMESTAMP, ZSENDER, ZID, ZTEXT, ZCONTENTMETADATA
           FROM ZMESSAGE WHERE ZCHAT = ? ORDER BY ZTIMESTAMP, Z_PK`,
        )
        .all(cr.Z_PK) as MessageRow[];

      if (msgs.length === 0) continue;

      const chatMessages: MessageRecord[] = [];
      let firstTs: number | null = null;
      let lastTs: number | null = null;

      for (const m of msgs) {
        let meta = null;
        if (m.ZCONTENTMETADATA) {
          meta = parseContentMetadata(m.ZCONTENTMETADATA as Uint8Array);
        }

        let fromMid: string | null = null;
        let fromName = "?";
        if (m.ZSENDER === null) {
          fromMid = myMid;
          fromName = "me";
        } else {
          const u = users.get(m.ZSENDER);
          fromMid = u?.mid || null;
          fromName = u?.name || "?";
        }

        const record: MessageRecord = {
          id: m.ZID,
          ts: m.ZTIMESTAMP,
          iso: iosTimestampToIso(m.ZTIMESTAMP),
          contentType: m.ZCONTENTTYPE,
          sendStatus: m.ZSENDSTATUS,
          fromMid,
          fromName,
          text: m.ZTEXT,
          contentMetadata: meta,
        };

        chatMessages.push(record);
        totalMessages++;

        if (firstTs === null) firstTs = m.ZTIMESTAMP;
        lastTs = m.ZTIMESTAMP;
      }

      messages.set(chat.chatMid, chatMessages);
      chatInfos.push({
        chatMid: chat.chatMid,
        kind: chat.kind as "group" | "dm",
        name: chat.name,
        count: chatMessages.length,
        firstIso: firstTs ? iosTimestampToIso(firstTs) : null,
        lastIso: lastTs ? iosTimestampToIso(lastTs) : null,
        file: `${chat.chatMid}.jsonl`,
      });
    }

    onProgress?.({ stage: "writing", current: 4, total: 5, message: "Writing output files..." });

    mkdirSync(outputDir, { recursive: true });

    for (const [chatMid, msgs] of messages) {
      const fname = `${chatMid}.jsonl`;
      const lines = msgs.map((m) => JSON.stringify(m)).join("\n");
      writeFileSync(join(outputDir, fname), `${lines}\n`, "utf-8");
    }

    chatInfos.sort((a, b) => b.count - a.count);

    const index = {
      account: myMid,
      exportedAt: new Date().toISOString(),
      chats: chatInfos,
    };
    writeFileSync(join(outputDir, "index.json"), JSON.stringify(index, null, 1), "utf-8");

    onProgress?.({ stage: "complete", current: 5, total: 5, message: "Parse complete" });

    const groups = chatInfos.filter((c) => c.kind === "group").length;
    const dms = chatInfos.filter((c) => c.kind === "dm").length;

    console.log(
      `[parse] messages=${totalMessages.toLocaleString()} chats=${chatInfos.length} (group=${groups}, dm=${dms}) -> ${outputDir}`,
    );

    return {
      account: myMid,
      exportedAt: index.exportedAt,
      chats: chatInfos,
      messages,
    };
  } finally {
    lineDb.close();
    ugDb.close();
  }
}

interface MessageRow {
  Z_PK: number;
  ZCONTENTTYPE: number;
  ZSENDSTATUS: number;
  ZTIMESTAMP: number;
  ZSENDER: number | null;
  ZID: number;
  ZTEXT: string | null;
  ZCONTENTMETADATA: Uint8Array | null;
}

export function findLineDatabases(
  extractedDir: string,
): { lineDb: string; unifiedGroupDb: string } | null {
  const files = readdirSync(extractedDir);

  const lineDb = files.find((f) => f.includes("Line.sqlite") && !f.includes("UnifiedGroup"));
  const unifiedGroupDb = files.find((f) => f.includes("UnifiedGroup.sqlite"));

  if (!lineDb || !unifiedGroupDb) return null;

  return {
    lineDb: join(extractedDir, lineDb),
    unifiedGroupDb: join(extractedDir, unifiedGroupDb),
  };
}

export function detectMyMid(lineDbPath: string): string {
  const db = new Database(lineDbPath, { readonly: true });
  try {
    const row = db
      .prepare(
        "SELECT ZMID FROM ZUSER WHERE ZCUSTOMNAME IS NOT NULL OR ZADDRESSBOOKNAME IS NOT NULL LIMIT 1",
      )
      .get() as { ZMID: string } | undefined;
    return row?.ZMID || "";
  } finally {
    db.close();
  }
}
