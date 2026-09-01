import { describe, expect, test } from "bun:test";
import { interactionModeFromUserAgent } from "./interactionEnvironment.js";

describe("interactionModeFromUserAgent", () => {
  test("Android wins over the Linux token in its UA", () => {
    expect(
      interactionModeFromUserAgent(
        "Mozilla/5.0 (Linux; Android 16; A059) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
      ),
    ).toBe("mobile");
  });

  test("iPhone and iPad use mobile operation semantics", () => {
    expect(
      interactionModeFromUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe("mobile");
    expect(
      interactionModeFromUserAgent(
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
      ),
    ).toBe("mobile");
  });

  test("iPadOS desktop-class UA is still mobile", () => {
    expect(
      interactionModeFromUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18 Safari/605.1.15",
        5,
      ),
    ).toBe("mobile");
  });

  test("Windows, macOS, Linux and ChromeOS use desktop operation semantics", () => {
    expect(interactionModeFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "desktop",
    );
    expect(
      interactionModeFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7)", 0),
    ).toBe("desktop");
    expect(interactionModeFromUserAgent("Mozilla/5.0 (X11; Linux x86_64)")).toBe("desktop");
    expect(interactionModeFromUserAgent("Mozilla/5.0 (X11; CrOS x86_64 16000.0.0)")).toBe(
      "desktop",
    );
  });

  test("unknown UAs default to the safer mobile behavior", () => {
    expect(interactionModeFromUserAgent("VylineEmbedded/1.0")).toBe("mobile");
  });
});
