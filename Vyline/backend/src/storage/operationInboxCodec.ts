import { createHash } from "node:crypto";

const TAG = "__vylineOperationValue";

function encodeValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === "bigint") return { [TAG]: "bigint", value: value.toString() };
  if (value instanceof Uint8Array) {
    return { [TAG]: "bytes", value: Buffer.from(value).toString("base64") };
  }
  if (value instanceof ArrayBuffer) {
    return { [TAG]: "bytes", value: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map((item) => encodeValue(item, ancestors));
  if (value && typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError("cyclic operation payload cannot be persisted");
    ancestors.add(value);
    const record: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined && typeof child !== "function") record[key] = encodeValue(child, ancestors);
    }
    ancestors.delete(value);
    return record;
  }
  return value;
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record[TAG] === "bigint" && typeof record.value === "string") return BigInt(record.value);
  if (record[TAG] === "bytes" && typeof record.value === "string") {
    return Buffer.from(record.value, "base64");
  }
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, decodeValue(child)]));
}

export function encodeOperationBatch(operations: readonly unknown[]): string {
  return JSON.stringify(encodeValue(operations, new WeakSet()));
}

export function decodeOperationBatch<T>(serialized: string): T[] {
  const decoded = decodeValue(JSON.parse(serialized));
  if (!Array.isArray(decoded)) throw new TypeError("stored operation batch must be an array");
  return decoded as T[];
}

export function operationBatchId(
  startCursor: { revision: string; globalRevision: string; individualRevision: string },
  endCursor: { revision: string; globalRevision: string; individualRevision: string },
  serializedOperations: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([startCursor, endCursor, serializedOperations]))
    .digest("hex");
}
