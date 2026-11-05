import { describe, expect, it } from "bun:test";
import {
  hasBetaFeatureConsentVersion,
  latestBetaFeatureDecision,
  type BetaConsentEvent,
} from "./betaConsent";

const event = (decision: BetaConsentEvent["decision"]): BetaConsentEvent => ({
  featureId: "feature-a",
  decision,
  enabled: decision === "accepted",
  occurredAt: "2026-11-02T00:00:00.000Z",
  featureVersion: "1",
  termsVersion: "2026-11-01",
});

describe("hasBetaFeatureConsentVersion", () => {
  it("requires the newest accepted event to match the current feature version", () => {
    expect(hasBetaFeatureConsentVersion([event("accepted")], "feature-a", "2")).toBe(false);
    expect(
      hasBetaFeatureConsentVersion(
        [event("accepted"), { ...event("accepted"), featureVersion: "2" }],
        "feature-a",
        "2",
      ),
    ).toBe(true);
    expect(
      hasBetaFeatureConsentVersion(
        [event("accepted"), { ...event("withdrawn"), featureVersion: "2" }],
        "feature-a",
        "2",
      ),
    ).toBe(false);
  });
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
