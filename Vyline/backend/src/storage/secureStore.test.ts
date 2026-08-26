import { describe, expect, test } from "bun:test";

import { protectSecret, unprotectSecret } from "./secureStore.js";

describe("secureStore", () => {
  test.skipIf(process.platform !== "win32")(
    "round-trips a secret through Windows DPAPI",
    async () => {
      const secret = `vyline-dpapi-${crypto.randomUUID()}`;

      const protectedValue = await protectSecret(secret);

      expect(protectedValue).not.toBe(secret);
      await expect(unprotectSecret(protectedValue)).resolves.toBe(secret);
    },
  );
});
