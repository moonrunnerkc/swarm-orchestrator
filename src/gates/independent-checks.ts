import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { assembleGateSet } from "./engine.ts";
import { unavailableObservation } from "./gate-definition.ts";
import type {
  IndependentCheck,
  IndependentVerificationOptions,
} from "./independent-verification.ts";
import {
  gitInstrumentTrees,
  observationDigest,
  observeInstrument,
  readUnderInstrument,
} from "./instrument-identity.ts";

const runGit = promisify(execFile);

/** What differs in the checkout from the base commit, untracked files included. */
async function changedInCheckout(checkout: string, baseCommit: string): Promise<readonly string[]> {
  const lines = async (args: readonly string[]) => {
    try {
      const { stdout } = await runGit("git", [...args], { cwd: checkout, maxBuffer: 64_000_000 });
      return stdout.split("\0").filter((line) => line.length > 0);
    } catch {
      return [];
    }
  };
  const [tracked, untracked] = await Promise.all([
    lines(["diff", "--name-only", "-z", "--no-renames", baseCommit, "--"]),
    lines(["ls-files", "-o", "--exclude-standard", "-z"]),
  ]);
  return [...new Set([...tracked, ...untracked])].sort();
}

/**
 * Capture configured commands and absent language checks without dropping unknown outcomes.
 *
 * Each command's instrument is observed against the base commit before and after it runs, and a
 * pass it reported under an instrument the patch altered is withheld (`reportedStatus` keeps what
 * the runner said). The base-configuration reading decides whether that pass can stand.
 */
export async function runChecks(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<readonly IndependentCheck[]> {
  const { gates } = await assembleGateSet({
    workspaceRoot: options.repositoryRoot,
    criteriaRef: options.baseCommit,
    ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
  });
  const trees = gitInstrumentTrees({
    root: checkout,
    referenceCommit: options.baseCommit,
    changed: await changedInCheckout(checkout, options.baseCommit),
    readReference: async (path) => {
      try {
        const { stdout } = await runGit("git", ["show", `${options.baseCommit}:${path}`], {
          cwd: checkout,
          maxBuffer: 64_000_000,
        });
        return stdout;
      } catch {
        return null;
      }
    },
    readCurrent: (path) => readFile(join(checkout, path), "utf8").catch(() => null),
    installedRoot: checkout,
  });

  const results: IndependentCheck[] = [];
  for (const gate of gates) {
    if (gate.source.kind === "inspection" && gate.source.unavailableReason === undefined) continue;
    const instrumented =
      gate.source.kind === "command"
        ? { command: gate.source.command, argv: gate.source.argv ?? null }
        : null;
    const before =
      instrumented === null ? null : await observeInstrument(instrumented, await trees());
    const observed =
      gate.source.kind === "inspection"
        ? unavailableObservation(gate.source.unavailableReason ?? "check unavailable")
        : gate.source.argv === undefined
          ? await options.commands.run(gate.source.command, { cwd: checkout, timeoutMs })
          : await options.commands.runVouched(gate.source.argv, { cwd: checkout, timeoutMs });
    const instrument =
      instrumented === null || before === null || observed.unavailable !== null
        ? null
        : {
            ...(await observeInstrument(instrumented, await trees())),
            before: observationDigest(before),
          };
    const reported = gate.parse(observed);
    const reading = readUnderInstrument(reported, instrument);
    results.push({
      id: gate.id,
      ...(gate.source.kind === "inspection" && gate.source.optionalAbsence === true
        ? { optionalAbsence: true }
        : {}),
      status: reading.status,
      detail: reading.detail,
      severity: gate.severity,
      parser: gate.parserName ?? "exit-code",
      observation: observed,
      ...(instrument === null ? {} : { instrument }),
      ...(reading.status === reported.status ? {} : { reportedStatus: reported.status }),
    });
  }
  return results;
}
