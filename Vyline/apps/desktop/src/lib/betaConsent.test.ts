import { describe, expect, it } from "bun:test";
import { latestBetaFeatureDecision, type BetaConsentEvent } from "./betaConsent";

const event = (decision: BetaConsentEvent["decision"]): BetaConsentEvent => ({
  featureId: "feature-a",
  decision,
  enabled: decision === "accepted",
  occurredAt: "2026-11-02T00:00:00.000Z",
  featureVersion: "1",
  termsVersion: "2026-11-01",
});

describe("latestBetaFeatureDecision", () => {
  it("uses the most recent decision so withdrawal revokes consent", () => {
    expect(latestBetaFeatureDecision([event("accepted"), event("withdrawn")], "feature-a")).toBe(
      "withdrawn",
    );
  });

  it("does not treat another feature's consent as acceptance", () => {
    expect(latestBetaFeatureDecision([event("accepted")], "feature-b")).toBeUndefined();
  });
});
