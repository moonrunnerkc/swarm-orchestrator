import { readFile } from "node:fs/promises";
import { type Pricing, parsePricing } from "./pricing.ts";

export const bundledPricingLocation = "the pricing snapshot bundled with this release";

/**
 * The floor under the published table: the same JSON, read from beside this module, through
 * the same parser, so a machine with no network still prices what it can rather than nothing.
 */
export async function readBundledPricing(): Promise<Pricing> {
  const text = await readFile(new URL("./model-pricing.v1.json", import.meta.url), "utf8");
  return parsePricing(text, bundledPricingLocation);
}
