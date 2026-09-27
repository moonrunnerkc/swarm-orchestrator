import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type BehaviorCheck, behaviorCheckSchema } from "../evidence/behavior-check.ts";
import { browserResultsPass } from "./browser-results.ts";
import type { GateCommandRunner, GateObservation } from "./gate-definition.ts";

const httpResult = z.object({
  unavailable: z.string().nullable(),
  failure: z.string().optional(),
  status: z.number().optional(),
  headers: z.record(z.string(), z.string().nullable()).optional(),
  body: z.string().optional(),
  truncated: z.boolean().optional(),
});
export interface BehaviorReading {
  readonly status: "accepted" | "rejected" | "unjudged";
  readonly detail: string;
}
const matches = (
  actual: string,
  assertions: readonly { kind: "equals" | "contains"; value: string }[],
) =>
  assertions.every((assertion) =>
    assertion.kind === "equals" ? actual === assertion.value : actual.includes(assertion.value),
  );

/** Evaluate raw bounded observations independently from the executable's own success claims. */
export function evaluateBehavior(
  check: BehaviorCheck,
  observation: GateObservation,
): BehaviorReading {
  if (observation.unavailable !== null || observation.outputTruncated)
    return {
      status: "unjudged",
      detail: observation.unavailable ?? "output limit reached; no complete observation",
    };
  if (check.kind === "cli")
    return {
      status:
        observation.exitCode === check.exitCode &&
        matches(observation.stdout, check.stdout) &&
        matches(observation.stderr, check.stderr)
          ? "accepted"
          : "rejected",
      detail:
        "expected exit status and bounded stream assertions evaluated over captured process output",
    };
  if (observation.exitCode !== 0)
    return { status: "rejected", detail: "behavior runner failed or timed out" };
  try {
    if (check.kind === "http") {
      const response = httpResult.parse(JSON.parse(observation.stdout));
      if (response.unavailable !== null || response.truncated)
        return {
          status: "unjudged",
          detail: response.unavailable ?? "HTTP body exceeded its bound",
        };
      let jsonMatches = true;
      if (check.json.length) {
        const body: unknown = JSON.parse(response.body ?? "");
        jsonMatches = check.json.every((assertion) => {
          let value: unknown = body;
          for (const key of assertion.path)
            value =
              typeof value === "object" && value !== null && Object.hasOwn(value, key)
                ? Reflect.get(value, key)
                : undefined;
          return value === assertion.equals;
        });
      }
      const accepted =
        response.failure === undefined &&
        response.status === check.status &&
        Object.entries(check.headers).every(
          ([name, value]) => response.headers?.[name] === value,
        ) &&
        matches(response.body ?? "", check.body) &&
        jsonMatches;
      return {
        status: accepted ? "accepted" : "rejected",
        detail: "HTTP response assertions evaluated; readiness is separate",
      };
    }
    const passed = browserResultsPass(JSON.parse(observation.stdout), check.expectedTests);
    return {
      status: passed ? "accepted" : "rejected",
      detail:
        "Playwright structured outcome; coverage and independent assertion counts remain unmeasured",
    };
  } catch {
    return { status: "unjudged", detail: "missing or malformed structured behavior result" };
  }
}

/** Run a sealed behavior instrument through the ordinary controlled command runner. */
export async function runBehaviorCheck(
  value: unknown,
  options: {
    commands: GateCommandRunner;
    checkout: string;
    readOnlyFiles?: readonly string[];
  },
): Promise<{ observation: GateObservation; reading: BehaviorReading }> {
  const check = behaviorCheckSchema.parse(value);
  const commandOptions = {
    cwd: join(options.checkout, check.cwd),
    timeoutMs: check.timeoutMs,
    maxOutputBytes: check.maxOutputBytes,
    ...(Object.keys(check.environment).length ? { environment: check.environment } : {}),
    ...(options.readOnlyFiles === undefined ? {} : { readOnlyFiles: options.readOnlyFiles }),
  };
  const argv =
    check.kind === "http"
      ? [
          "node",
          "--input-type=module",
          "-e",
          await readFile(new URL("./http-check-runner.mjs", import.meta.url), "utf8"),
          JSON.stringify(check),
        ]
      : check.argv;
  if (
    check.kind === "browser" &&
    (!argv.includes("--reporter=json") ||
      !argv.some((word) => word.endsWith("playwright/test/cli.js")))
  )
    throw new Error(
      "browser checks require the installed @playwright/test/cli.js and --reporter=json; install the project's pinned runner and browsers explicitly",
    );
  const observation = await options.commands.runVouched(argv, {
    ...commandOptions,
    ...(check.kind === "cli" ? { stdin: check.stdin } : {}),
  });
  return { observation, reading: evaluateBehavior(check, observation) };
}
