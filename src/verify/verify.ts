import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { detectChecks } from "../config/detect.ts";
import { readSwarmToml, type SwarmToml } from "../config/swarm-toml.ts";
import { type ChangeRequest, resolveChange } from "./change.ts";
import { applyChange, cloneBase, restoreFromBase } from "./checkout.ts";
import {
  againstBase,
  type CheckRun,
  environmentOf,
  passRate,
  prepareDependencies,
  privateHome,
  runCheck,
  runChecks,
} from "./checks.ts";
import { instrument } from "./coverage.ts";
import { measureBase, overlaySealed, readSealed, runSealed, swarmHome } from "./held-out.ts";
import { mutationWitness } from "./mutation.ts";
import type { Baseline, Coverage, HeldOut, Mutation, Predicate, Statement } from "./predicate.ts";
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
  const home = options.swarmHome ?? swarmHome();
  try {
    // Read from the base before the change is applied, so the change cannot rewrite its judges.
    const config: SwarmToml | null = await readSwarmToml(checkout.dir);
    const checks = config?.checks ?? (await detectChecks(checkout.dir));
    const sealed = await readSealed(options.workspace, home);
    const scratch = dirname(checkout.dir);
    const context = {
      dir: checkout.dir,
      home: await privateHome(scratch),
      timeoutMs: (config?.timeoutMinutes ?? 20) * 60_000,
      signal: options.signal,
    };
    const reasons: string[] = [];
    const failures: string[] = [];
    // What inherited failures printed: not a refusal, but what an agent would act on.
    const inheritedText: string[] = [];
    let runs: readonly CheckRun[] = [];
    let baseline: Baseline = skipped("no checks are declared");
    let heldOut: HeldOut = skipped("no held-out checks are sealed for this workspace");
    let coverage: Coverage = skipped("the checks did not run");
    let mutation: Mutation = skipped("the checks did not run");
    const dependencies = await prepareDependencies(
      options.workspace,
      config?.setup ?? null,
      context,
    );
    if (checks.length > 0 && dependencies.failure === null) {
      const environment = await environmentOf(checkout.dir, checks, dependencies.mode);
      const workspace = options.workspace;
      baseline = await measureBase({
        checkout,
        checks,
        sealed,
        context,
        home,
        environment,
        workspace,
      });
    }
    const applied = await applyChange(checkout, change.patch);
    const paths = applied.applied ? applied.result.changed.map((file) => file.path) : [];
    const protectedPaths = checkProtectedPaths(paths, config?.allow ?? []);
    // A change to a lockfile or manifest needs the setup run again on the changed tree.
    const resetup =
      config?.setup != null &&
      dependencies.failure === null &&
      protectedPaths.changed.some((f) => f.category === "lockfiles" || f.category === "manifests")
        ? await runCheck({ name: "setup", command: config.setup, kind: "other" }, context)
        : null;
    const setupFailure =
      dependencies.failure ?? (resetup?.result.result === "pass" ? null : resetup);

    if (!applied.applied) {
      reasons.push(applied.reason);
      failures.push(applied.reason);
    } else if (checks.length === 0) {
      reasons.push("no checks are declared in swarm.toml or the project's manifests");
    } else if (setupFailure !== null) {
      reasons.push("the setup command failed");
      failures.push(`setup failed:\n${setupFailure.outputTail}`);
    } else {
      const base = baseline.status === "measured" ? baseline.checks : [];
      const source = applied.result.changed.filter(
        (file) => file.status !== "deleted" && categoryOf(file.path) === null,
      );
      const instrumented = await instrument(checks, source, scratch, context);
      const wrapped = "wrap" in instrumented ? instrumented.wrap : null;
      runs = (
        await runChecks(
          checks.map((check) => wrapped?.(check).check ?? check),
          context,
          (check) => wrapped?.(check).env ?? {},
        )
      ).map((run, at) => againstBase(run, base[at]));
      coverage = "read" in instrumented ? await instrumented.read() : instrumented;
      for (const [at, run] of runs.entries()) {
        const { name, result } = run.result;
        if (result === "pass") continue;
        if (result === "pre-existing-failure") {
          reasons.push(`check ${name} fails at the base commit too, so it measures nothing here`);
          inheritedText.push(`$ ${run.result.command}\n${run.outputTail}`);
          continue;
        }
        const broke = result === "fail" ? "fails" : "could not run";
        reasons.push(
          base[at]?.result === "pass"
            ? `check ${name} regressed: it passes at the base commit and ${broke} with the change`
            : `check ${name} ${result === "fail" ? "failed" : "could not run"}`,
        );
        failures.push(`$ ${run.result.command}\n${run.outputTail}`);
      }
      const tests = checks.filter((check) => check.kind === "test");
      mutation = runs.every((run) => run.result.result === "pass")
        ? await mutationWitness(source, coverage, tests, context)
        : skipped("a check did not pass, so no mutant can be told apart from that failure");
      if (sealed !== null) {
        await restoreFromBase(
          checkout,
          protectedPaths.changed.map((finding) => finding.path),
        );
        await overlaySealed(options.workspace, sealed, checkout.dir, home);
        const hidden = await runSealed(sealed, context, scratch);
        const visibleRate = passRate(runs.map((run) => run.result));
        const hiddenRate = passRate(hidden.runs.map((run) => run.result));
        heldOut = {
          status: "measured",
          checks: hidden.runs.map((run) => run.result),
          visiblePassRate: visibleRate,
          heldOutPassRate: hiddenRate,
          gap: visibleRate - hiddenRate,
          judge: { processes: hidden.processes, assertionCalls: hidden.assertionCalls },
        };
        // The author never saw these, so their output is not handed back either.
        if (hiddenRate < 1) reasons.push("a held-out check failed");
        reasons.push(...hidden.problems);
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
    // A check that fails at base and still fails leaves the change unmeasured, never passed.
    const inherited = runs.some((run) => run.result.result === "pre-existing-failure");
    const verdict = failed ? "fail" : checks.length === 0 || inherited ? "unmeasured" : "pass";
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
      baseline,
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
        ...runs
          .filter((run) => run.result.result === "pre-existing-failure")
          .map(
            (run) =>
              `check ${run.result.name}: fails at the base commit (output sha256:${run.result.baseOutputSha256}) and still fails`,
          ),
        ...(baseline.status === "measured" ? baseline.heldOut : [])
          .filter((check) => check.result === "pass")
          .map(
            (check) =>
              `held-out check ${check.name}: passes at the base commit, so it does not tell this change apart`,
          ),
        ...(
          [
            ["baseline", baseline],
            ["held-out", heldOut],
            ["coverage", coverage],
            ["mutation", mutation],
          ] as const
        ).flatMap(([name, value]) =>
          value.status === "unmeasured" ? [`${name}: ${value.reason}`] : [],
        ),
      ],
      verifier: { name: "swarm-verify", version: options.version },
    };
    const statement = buildStatement({
      treeSha256: applied.applied ? applied.result.treeSha256 : emptyTree,
      patchSha256: createHash("sha256").update(change.patch).digest("hex"),
      patchName: "change.patch",
      predicate,
    });
    const failureText = [...failures, ...inheritedText].join("\n\n");
    return { statement, patch: change.patch, failureText };
  } finally {
    await checkout.remove();
  }
}

/** The tree digest of nothing, for a change that never produced a tree. */
const emptyTree = createHash("sha256").update("").digest("hex");
