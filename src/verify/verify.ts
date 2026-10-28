import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { detectChecks } from "../config/detect.ts";
import { readSwarmToml, type SwarmToml } from "../config/swarm-toml.ts";
import { type ChangeRequest, resolveChange } from "./change.ts";
import { applyChange, cloneBase, restoreFromBase } from "./checkout.ts";
import {
  type CheckRun,
  environmentOf,
  passRate,
  prepareDependencies,
  privateHome,
  runChecks,
} from "./checks.ts";
import { instrument } from "./coverage.ts";
import { overlaySealed, readSealed } from "./held-out.ts";
import { mutationWitness } from "./mutation.ts";
import type { Coverage, HeldOut, Mutation, Predicate, Statement } from "./predicate.ts";
import { buildStatement } from "./predicate.ts";
import { categoryOf, checkProtectedPaths } from "./protected-paths.ts";

export interface VerifyOptions {
  readonly workspace: string;
  readonly request: ChangeRequest;
  readonly producer?: { readonly model?: string; readonly promptSha256?: string };
  readonly swarmHome?: string;
  readonly signal?: AbortSignal;
  readonly version: string;
}

export interface VerifyOutcome {
  readonly statement: Statement;
  readonly patch: Buffer;
  /** What failed, as the checks printed it: the text a person or the agent acts on. */
  readonly failureText: string;
}

const skipped = (reason: string) => ({ status: "unmeasured" as const, reason });

export async function verifyChange(options: VerifyOptions): Promise<VerifyOutcome> {
  const change = await resolveChange(options.workspace, options.request);
  const checkout = await cloneBase(options.workspace, change.baseCommit);
  try {
    // Read from the base before the change is applied, so the change cannot rewrite its judges.
    const config: SwarmToml | null = await readSwarmToml(checkout.dir);
    const checks = config?.checks ?? (await detectChecks(checkout.dir));
    const sealed = await readSealed(options.workspace, options.swarmHome);
    const applied = await applyChange(checkout, change.patch);
    const context = {
      dir: checkout.dir,
      home: await privateHome(dirname(checkout.dir)),
      timeoutMs: (config?.timeoutMinutes ?? 20) * 60_000,
      signal: options.signal,
    };
    const reasons: string[] = [];
    const failures: string[] = [];
    let runs: readonly CheckRun[] = [];
    let heldOut: HeldOut = skipped("no held-out checks are sealed for this workspace");
    let coverage: Coverage = skipped("the checks did not run");
    let mutation: Mutation = skipped("the checks did not run");
    const paths = applied.applied ? applied.result.changed.map((file) => file.path) : [];
    const protectedPaths = checkProtectedPaths(paths, config?.allow ?? []);
    const dependencies = await prepareDependencies(
      options.workspace,
      config?.setup ?? null,
      context,
    );

    if (!applied.applied) {
      reasons.push(applied.reason);
      failures.push(applied.reason);
    } else if (checks.length === 0) {
      reasons.push("no checks are declared in swarm.toml or the project's manifests");
    } else if (dependencies.failure !== null) {
      reasons.push("the setup command failed");
      failures.push(`setup failed:\n${dependencies.failure.outputTail}`);
    } else {
      const source = applied.result.changed.filter(
        (file) => file.status !== "deleted" && categoryOf(file.path) === null,
      );
      const scratch = dirname(checkout.dir);
      const instrumented = await instrument(checks, source, scratch, context);
      const wrapped = "wrap" in instrumented ? instrumented.wrap : null;
      runs = await runChecks(
        checks.map((check) => wrapped?.(check).check ?? check),
        context,
        (check) => wrapped?.(check).env ?? {},
      );
      coverage = "read" in instrumented ? await instrumented.read() : instrumented;
      for (const run of runs.filter((one) => one.result.result !== "pass")) {
        reasons.push(
          `check ${run.result.name} ${run.result.result === "fail" ? "failed" : "could not run"}`,
        );
        failures.push(`$ ${run.result.command}\n${run.outputTail}`);
      }
      const tests = checks.filter((check) => check.kind === "test");
      mutation = runs.every((run) => run.result.result === "pass")
        ? await mutationWitness(source, coverage, tests, context)
        : skipped("a check failed, so no mutant can be told apart from that failure");
      if (sealed !== null) {
        await restoreFromBase(
          checkout,
          protectedPaths.changed.map((finding) => finding.path),
        );
        await overlaySealed(options.workspace, sealed, checkout.dir, options.swarmHome);
        const hidden = await runChecks(sealed.checks, context);
        const visibleRate = passRate(runs.map((run) => run.result));
        const hiddenRate = passRate(hidden.map((run) => run.result));
        heldOut = {
          status: "measured",
          checks: hidden.map((run) => run.result),
          visiblePassRate: visibleRate,
          heldOutPassRate: hiddenRate,
          gap: visibleRate - hiddenRate,
        };
        // The author never saw these, so their output is not handed back either.
        if (hiddenRate < 1) reasons.push("a held-out check failed");
      }
    }
    for (const violation of protectedPaths.violations) {
      reasons.push(`${violation.path} (${violation.category}) changed together with source`);
    }
    if (protectedPaths.violations.length > 0) {
      failures.push(
        `protected paths changed together with source: ${protectedPaths.violations.map((v) => v.path).join(", ")}`,
      );
    }

    const failed =
      !applied.applied ||
      failures.length > 0 ||
      (heldOut.status === "measured" && heldOut.heldOutPassRate < 1);
    const verdict = failed ? "fail" : checks.length === 0 ? "unmeasured" : "pass";
    const predicate: Predicate = {
      verdict,
      reasons,
      base: { commit: change.baseCommit },
      change: {
        source: change.source,
        applied: applied.applied,
        files: applied.applied
          ? applied.result.changed.map(({ path, status }) => ({ path, status }))
          : [],
      },
      checks: runs.map((run) => run.result),
      heldOut,
      protectedPaths: {
        changed: [...protectedPaths.changed],
        violations: [...protectedPaths.violations],
        allowed: [...protectedPaths.allowed],
      },
      coverage,
      mutation,
      producer: { ...options.producer },
      environment: await environmentOf(checkout.dir, checks, dependencies.mode),
      unmeasured: [
        ["held-out", heldOut],
        ["coverage", coverage],
        ["mutation", mutation],
      ].flatMap(([name, value]) =>
        typeof value === "object" && value.status === "unmeasured"
          ? [`${name}: ${value.reason}`]
          : [],
      ),
      verifier: { name: "swarm-verify", version: options.version },
    };
    const statement = buildStatement({
      treeSha256: applied.applied ? applied.result.treeSha256 : emptyTree,
      patchSha256: createHash("sha256").update(change.patch).digest("hex"),
      patchName: "change.patch",
      predicate,
    });
    return { statement, patch: change.patch, failureText: failures.join("\n\n") };
  } finally {
    await checkout.remove();
  }
}

/** The tree digest of nothing, for a change that never produced a tree. */
const emptyTree = createHash("sha256").update("").digest("hex");
