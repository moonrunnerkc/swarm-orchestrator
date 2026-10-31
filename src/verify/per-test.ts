import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DeclaredCheck } from "../config/swarm-toml.ts";
import { againstBase, type CheckContext, type CheckRun, runCheck } from "./checks.ts";
import { prepareJudge, readJudge } from "./judge.ts";
import type { CheckResult, TestJudgment } from "./predicate.ts";
import {
  livesIn,
  parseReport,
  type ReportPlan,
  reportPlan,
  type TestEvidence,
  type TestReport,
} from "./test-report.ts";

export interface MeasuredRun {
  readonly run: CheckRun;
  readonly evidence: TestEvidence;
}

export type Wrap = (check: DeclaredCheck) => {
  readonly check: DeclaredCheck;
  readonly env: Readonly<Record<string, string>>;
};

/** Report plans for the declared checks, read against the base's package.json scripts. */
export async function reportPlans(
  dir: string,
  checks: readonly DeclaredCheck[],
): Promise<readonly (ReportPlan | null)[]> {
  let scripts: Record<string, unknown> = {};
  try {
    scripts = JSON.parse(await readFile(join(dir, "package.json"), "utf8")).scripts ?? {};
  } catch {
    // No manifest, or one that does not parse: only commands that name a runner are recognized.
  }
  return checks.map((check) => reportPlan(check.command, scripts));
}

async function goModule(dir: string): Promise<string | null> {
  const text = await readFile(join(dir, "go.mod"), "utf8").catch(() => "");
  return /^module\s+(\S+)/m.exec(text)?.[1] ?? null;
}

/**
 * Runs a declared check with its runner's reporter appended and, for a test check, the judge
 * loaded. The recorded command stays the declared one.
 */
export async function runMeasured(input: {
  readonly check: DeclaredCheck;
  readonly plan: ReportPlan | null;
  readonly context: CheckContext;
  readonly scratch: string;
  readonly label: string;
  readonly judge: boolean;
  readonly wrap?: Wrap | null | undefined;
}): Promise<MeasuredRun> {
  const { check, plan, context } = input;
  const directory = join(input.scratch, "reports");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${input.label}-${check.name.replace(/[^\w.-]/g, "_")}.report`);
  await rm(file, { force: true });
  const reported = plan === null ? check : { ...check, command: plan.command(file) };
  const wrapped = input.wrap?.(reported) ?? { check: reported, env: {} };
  const judge =
    input.judge && check.kind === "test"
      ? await prepareJudge(input.scratch, `${input.label}-${check.name}`, context.dir)
      : null;
  const ran = await runCheck(wrapped.check, context, { ...judge?.env, ...wrapped.env });
  const run = { ...ran, result: { ...ran.result, command: check.command } };
  const judged = judge === null ? null : (await readJudge(judge.report)).problem;
  if (plan === null) {
    return { run, evidence: { runner: null, report: null, unreadable: null, judge: judged } };
  }
  const text = run.notRun === null ? await readFile(file, "utf8").catch(() => null) : null;
  const report =
    text === null ? null : parseReport(plan.runner, text, context.dir, await goModule(context.dir));
  const unreadable =
    run.notRun !== null
      ? `the command could not run: ${run.notRun}`
      : text === null
        ? `the ${plan.runner} report could not be parsed: the command wrote none`
        : report === null
          ? `the ${plan.runner} report could not be parsed`
          : null;
  return { run, evidence: { runner: plan.runner, report, unreadable, judge: judged } };
}

type Lists = Omit<TestJudgment, "runner" | "counts">;

/**
 * Test by test: passing at base and not with the change is a regression; failing at base and
 * passing is fixed; failing at both is pre-existing; present at base and missing is a deletion,
 * allowed only where `deletable` says the change may edit the file the test lived in. A test
 * that did not run at base and fails with the change is newly failing.
 */
export function compareReports(
  base: TestReport,
  head: TestReport,
  deletable: (file: string | null) => boolean,
): Omit<TestJudgment, "runner"> {
  const lists: { [key in keyof Lists]: string[] } = {
    fixed: [],
    regressed: [],
    preExisting: [],
    deleted: [],
    allowedDeletions: [],
    newlyFailing: [],
  };
  let passing = 0;
  let added = 0;
  let skipped = 0;
  for (const [id, before] of Object.entries(base)) {
    const after = head[id];
    if (after === undefined) {
      (deletable(before.file) ? lists.allowedDeletions : lists.deleted).push(id);
    } else if (before.status === "pass") {
      if (after.status === "pass") passing += 1;
      else lists.regressed.push(id);
    } else if (after.status === "pass") lists.fixed.push(id);
    else if (before.status === "fail") lists.preExisting.push(id);
    else if (after.status === "fail") lists.newlyFailing.push(id);
    else skipped += 1;
  }
  for (const [id, after] of Object.entries(head)) {
    if (id in base) continue;
    if (after.status === "pass") added += 1;
    else if (after.status === "fail") lists.newlyFailing.push(id);
    else skipped += 1;
  }
  const counts = { passing, added, skipped } as TestJudgment["counts"];
  const capped = {} as Lists;
  for (const [key, ids] of Object.entries(lists) as [keyof Lists, string[]][]) {
    counts[key] = ids.length;
    capped[key] = ids.slice(0, 100);
  }
  return { counts, ...capped };
}

export interface CheckJudgment {
  readonly run: CheckRun;
  readonly reasons: readonly string[];
  /** What blocks the verdict, as the check printed it; null when nothing does. */
  readonly failure: string | null;
  /** What failed at base and still fails: not a refusal, but what an agent would act on. */
  readonly inherited: string | null;
  /** Why the check measured nothing, when its runner's report could not be read. */
  readonly unmeasured: string | null;
}

const listed = (ids: readonly string[], total: number) =>
  total <= 5 ? ids.slice(0, 5).join(", ") : `${ids.slice(0, 5).join(", ")} and ${total - 5} more`;

/** One check with the change, judged against its base run. */
export function judgeCheck(
  head: MeasuredRun,
  base: { readonly result: CheckResult; readonly evidence: TestEvidence } | undefined,
  deletable: (file: string | null) => boolean,
): CheckJudgment {
  const { name, command, kind } = head.run.result;
  const output = `$ ${command}\n${head.run.outputTail}`;
  // A judge problem the base run had too is the project's, not the change's, unless the change
  // patched something more.
  const found = head.evidence.judge;
  const atBase = base?.evidence.judge ?? null;
  const tampered =
    found !== null &&
    (atBase === null || (found.startsWith("the code under test") && found !== atBase))
      ? `check ${name}: ${found}`
      : null;
  if (head.evidence.runner === null) {
    const run = againstBase(head.run, base?.result);
    const { result } = run.result;
    const reasons: string[] = [];
    if (kind === "test") {
      reasons.push(
        `check ${name}: no test runner is recognized in its command, so its exit code judged it`,
      );
    }
    if (tampered !== null) reasons.push(tampered);
    if (result === "pre-existing-failure") {
      reasons.push(`check ${name} fails at the base commit too, so it measures nothing here`);
    } else if (result !== "pass") {
      const broke = result === "fail" ? "fails" : "could not run";
      reasons.push(
        base?.result.result === "pass"
          ? `check ${name} regressed: it passes at the base commit and ${broke} with the change`
          : `check ${name} ${result === "fail" ? "failed" : "could not run"}`,
      );
    }
    const blocks = tampered !== null || (result !== "pass" && result !== "pre-existing-failure");
    const failed = tampered !== null && result === "pass" ? "fail" : result;
    return {
      run: { ...run, result: { ...run.result, result: failed } },
      reasons,
      failure: blocks ? output : null,
      inherited: result === "pre-existing-failure" ? output : null,
      unmeasured: null,
    };
  }
  const unreadable =
    base === undefined
      ? "the base commit has no run of it"
      : base.evidence.unreadable !== null
        ? `at the base commit, ${base.evidence.unreadable}`
        : head.evidence.unreadable !== null
          ? `with the change, ${head.evidence.unreadable}`
          : null;
  if (unreadable !== null || base?.evidence.report == null || head.evidence.report === null) {
    return {
      run: { ...head.run, result: { ...head.run.result, result: "unmeasured" } },
      reasons: [`check ${name} is unmeasured: ${unreadable ?? "a report is missing"}`],
      failure: null,
      inherited: null,
      unmeasured: `check ${name}: ${unreadable ?? "a report is missing"}`,
    };
  }
  const compared = compareReports(base.evidence.report, head.evidence.report, deletable);
  const { counts } = compared;
  const reasons: string[] = [];
  if (counts.regressed > 0) {
    reasons.push(
      `check ${name}: ${counts.regressed} test(s) pass at the base commit and fail with the change: ${listed(compared.regressed, counts.regressed)}`,
    );
  }
  if (counts.deleted > 0) {
    reasons.push(
      `check ${name}: ${counts.deleted} test(s) at the base commit are missing with the change: ${listed(compared.deleted, counts.deleted)}`,
    );
  }
  if (counts.newlyFailing > 0) {
    reasons.push(
      `check ${name}: ${counts.newlyFailing} test(s) that did not run at the base commit fail with the change: ${listed(compared.newlyFailing, counts.newlyFailing)}`,
    );
  }
  if (tampered !== null) reasons.push(tampered);
  const testsBlock = counts.regressed + counts.deleted + counts.newlyFailing > 0;
  // Every test in the report passed, yet the command now fails where it passed at base.
  const exitedWorse =
    !testsBlock && base.result.exitCode === 0 && head.run.result.exitCode !== 0
      ? `check ${name} exits ${head.run.result.exitCode} with the change and 0 at the base commit, though no test in its report fails`
      : null;
  if (exitedWorse !== null) reasons.push(exitedWorse);
  if (counts.preExisting > 0) {
    reasons.push(
      `check ${name}: ${counts.preExisting} test(s) fail at the base commit and still fail, which does not block: ${listed(compared.preExisting, counts.preExisting)}`,
    );
  }
  if (counts.allowedDeletions > 0) {
    reasons.push(
      `check ${name}: ${counts.allowedDeletions} test(s) removed from test files swarm.toml lets the change edit`,
    );
  }
  const blocks = testsBlock || tampered !== null || exitedWorse !== null;
  return {
    run: {
      ...head.run,
      result: {
        ...head.run.result,
        result: blocks ? "fail" : "pass",
        tests: { runner: head.evidence.runner, ...compared },
      },
    },
    reasons,
    failure: blocks ? output : null,
    inherited: !blocks && counts.preExisting > 0 ? output : null,
    unmeasured: null,
  };
}

/**
 * Whether a mutant made a test check fail: a test passing with the change and not under the
 * mutant, or, without reports to compare, a command that passed and now does not.
 */
export function killedBy(head: MeasuredRun, mutant: MeasuredRun): boolean {
  const before = head.evidence.report;
  const after = mutant.evidence.report;
  // A mutant that keeps the runner from writing its report broke every test it would have run.
  if (before !== null) {
    return (
      after === null ||
      Object.entries(before).some(
        ([id, entry]) => entry.status === "pass" && after[id]?.status !== "pass",
      )
    );
  }
  return head.run.result.exitCode === 0 && mutant.run.result.result !== "pass";
}

/** Whether a test's file is one the change edited and swarm.toml lets it edit. */
export function deletableIn(changed: readonly string[], testsAllowed: boolean) {
  return (file: string | null) => testsAllowed && changed.some((path) => livesIn(file, path));
}
