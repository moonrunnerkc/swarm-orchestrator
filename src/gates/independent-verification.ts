import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock } from "../core/clock.ts";
import { assembleGateSet } from "./engine.ts";
import { normalizePath } from "./file-set.ts";
import { defaultGateTimeoutMs, type GateCommandRunner } from "./gate-definition.ts";
import { pathsInPatch } from "./patch-paths.ts";

/**
 * Verification that does not trust the tree it is verifying.
 *
 * Every gate the run itself executed ran in the workspace the run was editing, with the tests
 * the run may have changed, under the environment the run was in, reading reports the run's own
 * processes wrote. Each of those is a place where a run can be measured by something it
 * controls. The ratchet and the sealed criteria close most of it, and what they cannot close is
 * the shape of the thing: a subject grading its own paper.
 *
 * So the final word is a separate run: a fresh checkout of the base commit somewhere the
 * workspace cannot reach, the patch applied to it, and the checks run there. Nothing from the
 * worker travels except the patch.
 */
export interface IndependentCheck {
  readonly id: string;
  readonly status: "passed" | "failed" | "not-applicable";
  readonly detail: string;
}

export interface IndependentVerification {
  /** Whether the patch applied cleanly to a fresh base. A patch that did not is not verified. */
  readonly applied: boolean;
  readonly checks: readonly IndependentCheck[];
  /** Why verification refused before running anything, or null where it ran. */
  readonly refusal: string | null;
  readonly verified: boolean;
  readonly checkoutPath: string | null;
}

export interface IndependentVerificationOptions {
  readonly repositoryRoot: string;
  readonly baseCommit: string;
  readonly patch: string;
  /** Paths the run declared it would never change. A patch touching one is refused outright. */
  readonly immutablePaths?: readonly string[];
  readonly commands: GateCommandRunner;
  readonly clock: Clock;
  readonly timeoutMs?: number;
}

export async function verifyIndependently(
  options: IndependentVerificationOptions,
): Promise<IndependentVerification> {
  const immutable = options.immutablePaths ?? [];
  const touched = pathsInPatch(options.patch);
  const forbidden = touched.filter((path) => matchesAny(path, immutable));
  if (forbidden.length > 0) {
    return {
      applied: false,
      checks: [],
      refusal:
        `the patch changes ${forbidden.join(", ")}, which the run declared immutable. ` +
        "Nothing was run: a patch that reaches a path the run promised not to touch is " +
        "refused before it is measured, not measured and then judged.",
      verified: false,
      checkoutPath: null,
    };
  }

  const checkout = await mkdtemp(join(tmpdir(), "swarm-verify-"));
  const timeoutMs = options.timeoutMs ?? defaultGateTimeoutMs;
  try {
    // A worktree of the base commit, not a copy of the workspace. Nothing the run wrote is
    // here except what the patch carries.
    const cloned = await options.commands.runVouched(
      ["git", "clone", "--quiet", "--no-hardlinks", options.repositoryRoot, checkout],
      { cwd: tmpdir(), timeoutMs },
    );
    if (cloned.exitCode !== 0) {
      return {
        applied: false,
        checks: [],
        refusal: `a fresh checkout could not be made: ${cloned.stderr.trim() || cloned.stdout.trim()}`,
        verified: false,
        checkoutPath: null,
      };
    }
    const reset = await options.commands.runVouched(
      ["git", "-C", checkout, "checkout", "--quiet", "--detach", options.baseCommit],
      { cwd: checkout, timeoutMs },
    );
    if (reset.exitCode !== 0) {
      return {
        applied: false,
        checks: [],
        refusal: `the base commit ${options.baseCommit} is not in the checkout`,
        verified: false,
        checkoutPath: null,
      };
    }

    const patchPath = join(checkout, ".swarm-verify.patch");
    await writeFile(patchPath, options.patch.endsWith("\n") ? options.patch : `${options.patch}\n`);
    const applied = await options.commands.runVouched(
      ["git", "-C", checkout, "apply", "--whitespace=nowarn", patchPath],
      { cwd: checkout, timeoutMs },
    );
    await rm(patchPath, { force: true });
    if (applied.exitCode !== 0) {
      return {
        applied: false,
        checks: [],
        refusal: null,
        verified: false,
        checkoutPath: null,
      };
    }

    const checks = await runChecks(checkout, options, timeoutMs);
    return {
      applied: true,
      checks,
      refusal: null,
      // A dynamic check that passed and no check that failed. An empty check list is not
      // verification: it is a checkout nothing measured.
      verified:
        checks.some((check) => check.status === "passed") &&
        !checks.some((check) => check.status === "failed"),
      checkoutPath: checkout,
    };
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
}

/**
 * The gates assembled from the base commit's manifests, not the patched tree's. A patch that
 * rewrites the test script would otherwise choose the instrument that measures it.
 */
async function runChecks(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<readonly IndependentCheck[]> {
  const { gates } = await assembleGateSet({
    workspaceRoot: options.repositoryRoot,
    criteriaRef: options.baseCommit,
  });

  const results: IndependentCheck[] = [];
  for (const gate of gates) {
    if (gate.source.kind !== "command") {
      continue;
    }
    const observed = await options.commands.run(gate.source.command, { cwd: checkout, timeoutMs });
    const reading = gate.parse(observed);
    results.push({ id: gate.id, status: reading.status, detail: reading.detail });
  }
  return results;
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  const normalized = normalizePath(path);
  return patterns.some((pattern) => {
    const normalizedPattern = normalizePath(pattern);
    if (normalizedPattern.endsWith("/**")) {
      return normalized.startsWith(normalizedPattern.slice(0, -2));
    }
    return normalized === normalizedPattern;
  });
}
