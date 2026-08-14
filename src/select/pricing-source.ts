import { bundledPricingLocation, readBundledPricing } from "./bundled-pricing.ts";
import { type Pricing, parsePricing } from "./pricing.ts";

/** Served from the repository, like the shortlist: a price change needs no release. */
export const defaultPricingUrl =
  "https://raw.githubusercontent.com/moonrunnerkc/swarm-orchestrator/main/src/select/model-pricing.v1.json";

export interface LoadedPricing {
  readonly pricing: Pricing;
  readonly origin: "published" | "bundled";
  readonly location: string;
  /** Why the published table was not used, or null when it was. */
  readonly fallbackReason: string | null;
}

interface PricingResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface PricingSource {
  readonly fetch: (url: string) => Promise<PricingResponse>;
}

/**
 * Unreachable and malformed are different failures, exactly as for the shortlist: an
 * unreachable table is an absence the snapshot covers; a malformed one is a broken publish
 * that quietly substituting older prices would hide from the person who could fix it.
 */
export async function loadPricing(source: PricingSource): Promise<LoadedPricing> {
  let text: string;
  try {
    const response = await source.fetch(defaultPricingUrl);
    if (!response.ok) {
      throw new Error(`the server answered ${response.status}`);
    }
    text = await response.text();
  } catch (error) {
    return {
      pricing: await readBundledPricing(),
      origin: "bundled",
      location: bundledPricingLocation,
      fallbackReason: `${defaultPricingUrl} could not be read (${describe(error)})`,
    };
  }
  return {
    pricing: parsePricing(text, defaultPricingUrl),
    origin: "published",
    location: defaultPricingUrl,
    fallbackReason: null,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
