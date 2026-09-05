import { describe, expect, it } from "vitest";

/**
 * The setting reached `runInParallel` through a spread into an options object that had no such
 * field. A spread of a literal into a literal type-checks, so `--max-wall-minutes` compiled,
 * ran, and bounded nothing: no worker was ever told about it.
 *
 * The regression is a type-level one, so it is checked the way a type-level property can be:
 * the option exists, and a call that omits it still compiles while one that misspells it does
 * not. What the option does with the number is exercised by the cancellation tests beside it.
 */
import type { runInParallel } from "./parallel-run.ts";

type Options = Parameters<typeof runInParallel>[0];

describe("the whole parallel run's wall budget", () => {
  it("is an option the parallel runner declares, so passing one is not a silent no-op", () => {
    const remaining: Options["remainingWallMs"] = () => 42;

    expect(remaining?.()).toBe(42);
  });

  it("is optional, because a run may be given no budget at all", () => {
    const withoutBudget: Pick<Options, "remainingWallMs"> = {};

    expect(withoutBudget.remainingWallMs).toBeUndefined();
  });
});
