import { z } from "zod";
import { predicateCatalogue, renderPredicateCatalogue } from "../evidence/predicate-catalogue.ts";
import { defineTool } from "./tool-definition.ts";

export function createClaimReferenceTool() {
  return defineTool({
    name: "claim_reference",
    description:
      "Read the full supported predicate examples. Examples describe syntax, never observations from this run.",
    inputSchema: z.strictObject({}),
    kind: "evidence",
    pathsFrom: () => [],
    execute: async () => ({
      text: renderPredicateCatalogue(predicateCatalogue),
      facts: { examples: predicateCatalogue.length, observations: 0 },
    }),
  });
}
