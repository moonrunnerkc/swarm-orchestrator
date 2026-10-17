import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type BehaviorCheck, behaviorCheckSchema } from "../evidence/behavior-check.ts";
import { browserExecutionSchema, browserInstrumentDigest } from "../evidence/browser-execution.ts";
import { runBrowserInstrument } from "./browser-instrument.ts";
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

/**
 * The lines of an expected multi-line output that the captured output does not reproduce, each
 * named by its number beside what was there, at most `limit` of them. Empty where they agree.
 */
export function differingLines(expected: string, actual: string, limit = 8): readonly string[] {
  const want = expected.split("\n");
  const got = actual.split("\n");
  const lines: string[] = [];
  for (let index = 0; index < Math.max(want.length, got.length); index += 1) {
    const wanted = want[index];
    const found = got[index];
    if (wanted === found) continue;
    if (lines.length === limit) {
      lines.push("further lines differ");
      break;
    }
    lines.push(
      `line ${index + 1} should be ${wanted === undefined ? "absent" : bound(wanted)} but was ${found === undefined ? "absent" : bound(found)}`,
    );
  }
  return lines;
}

const bound = (text: string) =>
  text.length <= mismatchExcerptChars
    ? JSON.stringify(text)
    : `${JSON.stringify(text.slice(0, mismatchExcerptChars))} (${text.length} characters, truncated)`;

/**
 * What a rejected command-line check saw against what it expected, for a check the worker may
 * see: the exit status, with what the process wrote to stderr where it was not the expected one,
 * and each stream assertion that did not hold, with the captured text beside it, line by line
 * where the expected text has several. Without this the repair brief said only that the
 * assertions were evaluated, so the worker had nothing to repair from; and a check that crashed
 * on the candidate read as an empty answer, with the crash itself left out. A withheld check
 * never gets this: its expectations are the part the worker must not see.
 */
export function describeCliMismatch(
  check: Extract<BehaviorCheck, { kind: "cli" }>,
  observation: GateObservation,
): string {
  const streams = [
    { name: "stdout", actual: observation.stdout, assertions: check.stdout },
    { name: "stderr", actual: observation.stderr, assertions: check.stderr },
  ];
  const parts = [
    observation.exitCode === check.exitCode
      ? `exit status ${observation.exitCode} as expected`
      : `exit status ${observation.exitCode}, expected ${check.exitCode}` +
        (observation.stderr.trim().length === 0 ? "" : `; stderr: ${bound(observation.stderr)}`),
    ...streams.flatMap((stream) =>
      stream.assertions
        .filter((assertion) => !matches(stream.actual, [assertion]))
        .map((assertion) =>
          assertion.kind === "equals" && assertion.value.trimEnd().includes("\n")
            ? `${stream.name} differs from the expected ${assertion.value.trimEnd().split("\n").length} line(s): ${differingLines(assertion.value, stream.actual).join("; ")}`
            : `${stream.name} ${assertion.kind === "equals" ? "should equal" : "should contain"} ` +
              `${bound(assertion.value)} but was ${bound(stream.actual)}`,
        ),
    ),
  ];
  return parts.join("; ");
}

const mismatchExcerptChars = 2000;

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
  if (check.kind === "browser") {
    const execution = browserExecutionSchema.safeParse(observation.browserExecution);
    if (
      !check.instrument ||
      !execution.success ||
      execution.data.instrumentDigest !== browserInstrumentDigest(check)
    )
      return {
        status: "unjudged",
        detail:
          "project-controlled Playwright output is runner-reported only; use a sealed browser instrument in an immutable container for acceptance",
      };
  }
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
  if (
    check.kind === "browser" &&
    observation.exitCode !== 0 &&
    /Executable doesn't exist|Cannot find (?:module|package)|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ENOENT.*swarm-browser\/node_modules|trusted Playwright modules|browser instrument refuses candidate modules/i.test(
      observation.stdout + observation.stderr,
    )
  )
    return {
      status: "unjudged",
      detail:
        "browser setup unavailable: install the project's pinned runner, dependencies and browser explicitly, then verify again",
    };
  if (check.kind === "browser") {
    try {
      const report = JSON.parse(observation.stdout);
      if (
        report.stats &&
        Object.values(report.stats).filter((value) => typeof value === "number").length &&
        report.stats.expected === 0 &&
        report.stats.unexpected === 0 &&
        report.stats.flaky === 0 &&
        report.stats.skipped === 0
      )
        return {
          status: "unjudged",
          detail: "browser runner collected no executable checks; repair test setup and selection",
        };
    } catch {
      /* The bounded runner failure or structured reader below retains the result. */
    }
  }
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
    const passed = browserResultsPass(
      JSON.parse(observation.stdout),
      check.expectedTests,
      check.instrument?.titles,
    );
    return {
      status: passed ? "accepted" : "rejected",
      detail:
        "sealed Playwright test identities and structured outcomes; coverage and independent assertion counts remain unmeasured",
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
  if (check.kind === "browser" && check.instrument) {
    const observation = await runBrowserInstrument(check, options.commands, options.checkout);
    return { observation, reading: evaluateBehavior(check, observation) };
  }
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
      : (check.argv ?? []);
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
