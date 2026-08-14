import { describe, expect, it } from "vitest";
import { readBundledPricing } from "./bundled-pricing.ts";
import { MalformedPricingError, parsePricing, rateFor } from "./pricing.ts";

const wellFormed = JSON.stringify({
  schemaVersion: 1,
  revision: "2026-08-14",
  rates: [
    { model: "anthropic:claude-opus-5", inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
    { model: "openai:gpt-5", inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
  ],
});

describe("parsePricing", () => {
  it("reads a well-formed table", () => {
    const pricing = parsePricing(wellFormed, "test");

    expect(pricing.revision).toBe("2026-08-14");
    expect(pricing.rates).toHaveLength(2);
  });

  it("refuses a table that is not JSON at all", () => {
    expect(() => parsePricing("nope{", "test")).toThrow(MalformedPricingError);
  });

  it("refuses a rate with a negative price rather than crediting a run", () => {
    const negative = JSON.stringify({
      schemaVersion: 1,
      revision: "r",
      rates: [{ model: "openai:gpt-5", inputPerMillionUsd: -1, outputPerMillionUsd: 10 }],
    });

    expect(() => parsePricing(negative, "test")).toThrow(MalformedPricingError);
  });

  it("refuses a duplicate model, whose winning rate would depend on array order", () => {
    const duplicated = JSON.stringify({
      schemaVersion: 1,
      revision: "r",
      rates: [
        { model: "openai:gpt-5", inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
        { model: "openai:gpt-5", inputPerMillionUsd: 3, outputPerMillionUsd: 4 },
      ],
    });

    expect(() => parsePricing(duplicated, "test")).toThrow(/declared twice/);
  });

  it("names an unreadable schema version before anything else", () => {
    const newer = JSON.stringify({ schemaVersion: 2, revision: "r", rates: [] });

    expect(() => parsePricing(newer, "test")).toThrow(/schema version 2/);
  });
});

describe("rateFor", () => {
  it("finds a model by its full spec and misses honestly", () => {
    const pricing = parsePricing(wellFormed, "test");

    expect(rateFor(pricing, "openai:gpt-5")?.inputPerMillionUsd).toBe(1.25);
    expect(rateFor(pricing, "openai:gpt-5-nano")).toBeNull();
  });
});

describe("the bundled pricing snapshot", () => {
  it("parses and covers the model the CLI defaults to", async () => {
    const pricing = await readBundledPricing();

    expect(rateFor(pricing, "anthropic:claude-opus-5")).not.toBeNull();
  });
});
