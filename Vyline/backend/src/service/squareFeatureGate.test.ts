import { describe, expect, test } from "bun:test";
import { SquareStore } from "../storage/squareStore.js";
import { withSquareEnabled } from "./squareFeatureGate.js";
import { readSquareCacheForGeneration } from "./squareService.js";

describe("Square feature gate", () => {
  test("rejects before invoking any Square operation while disabled", async () => {
    const store = new SquareStore(":memory:");
    let calls = 0;
    await expect(
      withSquareEnabled(store, async () => {
        calls += 1;
        return "network";
      }),
    ).rejects.toMatchObject({ code: "SQUARE_DISABLED" });
    expect(calls).toBe(0);
    store.close();
  });

  test("invokes operation after explicit enablement", async () => {
    const store = new SquareStore(":memory:");
    store.setEnabled(true);
    await expect(withSquareEnabled(store, async () => "ok")).resolves.toBe("ok");
    store.close();
  });

  test("does not return stale cache after disable changes the generation", () => {
    const store = new SquareStore(":memory:");
    store.setEnabled(true);
    const generation = store.getGeneration();
    store.upsertRoom({ id: "room", name: "cached" });
    store.setEnabled(false);
    expect(() => readSquareCacheForGeneration(store, generation)).toThrow(
      expect.objectContaining({ code: "SQUARE_DISABLED" }),
    );
    store.close();
  });
});
