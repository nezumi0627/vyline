export type SqliteDurability = {
  journalMode: "WAL" | "DELETE";
  synchronous: "NORMAL" | "FULL";
};

export function getSqliteDurability(env: NodeJS.ProcessEnv): SqliteDurability {
  const journalMode = (env.VYLINE_SQLITE_JOURNAL_MODE ?? "WAL").toUpperCase();
  const synchronous = (env.VYLINE_SQLITE_SYNCHRONOUS ?? "NORMAL").toUpperCase();
  if (journalMode !== "WAL" && journalMode !== "DELETE") {
    throw new Error("VYLINE_SQLITE_JOURNAL_MODE must be WAL or DELETE");
  }
  if (synchronous !== "NORMAL" && synchronous !== "FULL") {
    throw new Error("VYLINE_SQLITE_SYNCHRONOUS must be NORMAL or FULL");
  }
  return { journalMode, synchronous };
}
