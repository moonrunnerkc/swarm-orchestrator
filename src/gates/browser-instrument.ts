import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BehaviorCheck } from "../evidence/behavior-check.ts";
import { browserExecutionSchema, browserInstrumentDigest } from "../evidence/browser-execution.ts";
import type { GateCommandRunner, GateObservation } from "./gate-definition.ts";

/** Run only sealed test bytes with harness configuration and immutable image dependencies. */
export async function runBrowserInstrument(
  check: Extract<BehaviorCheck, { kind: "browser" }>,
  commands: GateCommandRunner,
  checkout: string,
): Promise<GateObservation> {
  const observation = await commands.runVouched(
    [
      "node",
      "--input-type=module",
      "-e",
      await readFile(new URL("./browser-instrument-runner.mjs", import.meta.url), "utf8"),
      JSON.stringify(check),
    ],
    {
      cwd: join(checkout, check.cwd),
      timeoutMs: check.timeoutMs,
      maxOutputBytes: check.maxOutputBytes,
      environment: {
        ...check.environment,
        PLAYWRIGHT_BROWSERS_PATH: check.environment.PLAYWRIGHT_BROWSERS_PATH ?? "/ms-playwright",
      },
      requiresImmutableRuntime: true,
    },
  );
  return observation.unavailable !== null
    ? observation
    : {
        ...observation,
        browserExecution: browserExecutionSchema.parse({
          kind: "sealed-playwright-v1",
          instrumentDigest: browserInstrumentDigest(check),
          runtime: "immutable-container",
        }),
      };
}
