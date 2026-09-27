import { z } from "zod";
import type { BehaviorCheck } from "./behavior-check.ts";
import { asJsonValue, digestOfJson } from "./canonical-json.ts";

export const browserExecutionSchema = z.strictObject({
  kind: z.literal("sealed-playwright-v1"),
  instrumentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runtime: z.literal("immutable-container"),
});

/** Bind the captured runtime boundary to the complete sealed browser definition. */
export function browserInstrumentDigest(check: BehaviorCheck): string {
  return digestOfJson(asJsonValue(check));
}
