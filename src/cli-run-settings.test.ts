import { describe, expect, it } from "vitest";
import { verificationReserve } from "./cli-run-settings.ts";

describe("the share of a run's total allowance held for final verification", () => {
  it("holds the policy floor where nothing was measured", () => {
    expect(verificationReserve(13 * 60_000, null)).toEqual({
      reserveMs: 60_000,
      basis: "policy-floor",
      measuredMs: null,
      capMs: 195_000,
    });
  });

  it("holds four times the measured preparation and checks, C1's 22.4 s preflight giving 89.6 s", () => {
    expect(verificationReserve(13 * 60_000, 22_400)).toEqual({
      reserveMs: 89_600,
      basis: "measured",
      measuredMs: 22_400,
      capMs: 195_000,
    });
  });

  it("never holds more than a quarter of the total, so earlier phases keep the rest", () => {
    expect(verificationReserve(13 * 60_000, 60_000).reserveMs).toBe(195_000);
    expect(verificationReserve(60_000, null)).toMatchObject({ reserveMs: 15_000, basis: "cap" });
  });
});
