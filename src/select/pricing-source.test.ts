import { describe, expect, it } from "vitest";
import { bundledPricingLocation } from "./bundled-pricing.ts";
import { MalformedPricingError } from "./pricing.ts";
import { defaultPricingUrl, loadPricing } from "./pricing-source.ts";

const published = JSON.stringify({
  schemaVersion: 1,
  revision: "2026-09-01",
  rates: [{ model: "openai:gpt-5", inputPerMillionUsd: 9, outputPerMillionUsd: 9 }],
});

describe("loadPricing", () => {
  it("takes the published table when the repository answers", async () => {
    const loaded = await loadPricing({
      fetch: (url) => {
        expect(url).toBe(defaultPricingUrl);
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(published) });
      },
    });

    expect(loaded.origin).toBe("published");
    expect(loaded.pricing.revision).toBe("2026-09-01");
    expect(loaded.fallbackReason).toBeNull();
  });

  it("falls back to the bundled snapshot when the repository is unreachable, and says so", async () => {
    const loaded = await loadPricing({
      fetch: () => Promise.reject(new Error("offline")),
    });

    expect(loaded.origin).toBe("bundled");
    expect(loaded.location).toBe(bundledPricingLocation);
    expect(loaded.fallbackReason).toMatch(/offline/);
  });

  it("raises on a malformed published table instead of quietly substituting older data", async () => {
    const attempt = loadPricing({
      fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{") }),
    });

    await expect(attempt).rejects.toThrow(MalformedPricingError);
  });
});
