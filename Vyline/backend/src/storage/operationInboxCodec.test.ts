import { expect, test } from "bun:test";
import { decodeOperationBatch, encodeOperationBatch } from "./operationInboxCodec.js";

test("durable operation payload preserves BigInt and binary fields without changing the source", () => {
  const source = {
    revision: 9_007_199_254_740_999n,
    message: { id: "m1", chunks: [new Uint8Array([0, 1, 254, 255])] },
  };
  const stored = encodeOperationBatch([source]);
  const decoded = decodeOperationBatch<typeof source>(stored);
  expect(decoded[0]?.revision).toBe(source.revision);
  expect(decoded[0]?.message.chunks[0]).toEqual(Buffer.from([0, 1, 254, 255]));
  expect(source.message.chunks[0]).toEqual(new Uint8Array([0, 1, 254, 255]));
});

