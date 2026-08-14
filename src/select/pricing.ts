import { z } from "zod";

/**
 * Per-model rates, served the same way as the model shortlist: a versioned JSON published
 * from the repository with a bundled snapshot behind it, so a price change reaches users
 * without a release. Prices move faster than releases, which is the whole point.
 */

export const pricingSchemaVersion = 1;

const modelRateSchema = z.object({
  /** The full spec the registry is asked for, such as "anthropic:claude-opus-5". */
  model: z.string().min(1),
  inputPerMillionUsd: z.number().nonnegative(),
  outputPerMillionUsd: z.number().nonnegative(),
});

const pricingSchema = z.object({
  schemaVersion: z.literal(pricingSchemaVersion),
  /** Dated rather than numbered: the table is curated, and the date is the useful fact. */
  revision: z.string().min(1),
  rates: z.array(modelRateSchema).min(1),
});

export type ModelRate = z.infer<typeof modelRateSchema>;
export type Pricing = z.infer<typeof pricingSchema>;

export class MalformedPricingError extends Error {
  readonly source: string;

  constructor(source: string, problem: string) {
    super(
      `the model pricing table from ${source} is not usable: ${problem}\n` +
        "A run still completes: its cost is recorded as unknown rather than invented.",
    );
    this.name = "MalformedPricingError";
    this.source = source;
  }
}

export function parsePricing(text: string, source: string): Pricing {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new MalformedPricingError(
      source,
      `it is not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  refuseUnreadableVersion(value, source);

  const parsed = pricingSchema.safeParse(value);
  if (!parsed.success) {
    throw new MalformedPricingError(source, `\n${z.prettifyError(parsed.error)}`);
  }
  refuseDuplicateModels(parsed.data, source);
  return parsed.data;
}

function refuseUnreadableVersion(value: unknown, source: string): void {
  const declared = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof declared === "number" && declared !== pricingSchemaVersion) {
    throw new MalformedPricingError(
      source,
      `it declares schema version ${declared} and this build reads version ` +
        `${pricingSchemaVersion}. Upgrade swarm to read it.`,
    );
  }
}

/** Two rates for one model would make the charge depend on array order. */
function refuseDuplicateModels(pricing: Pricing, source: string): void {
  const seen = new Set<string>();
  for (const rate of pricing.rates) {
    if (seen.has(rate.model)) {
      throw new MalformedPricingError(source, `model "${rate.model}" is declared twice`);
    }
    seen.add(rate.model);
  }
}

/** Null is an honest miss the caller must handle, never a zero. */
export function rateFor(pricing: Pricing, modelSpec: string): ModelRate | null {
  return pricing.rates.find((rate) => rate.model === modelSpec) ?? null;
}
