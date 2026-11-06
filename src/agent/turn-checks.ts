import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  constraintEvidence,
  type DeclaredCheck,
  declaredChecks,
  parseReport,
  reportPlans,
  structureEvidence,
  type TestReport,
} from "swarm-verify";
import type { Chokepoint } from "../tools/chokepoint.ts";
import {
  affectedTests,
  excerpt,
  failuresDetail,
  importGraph,
  livesIn,
  shellWord,
  testPathOf,
  testPattern,
} from "./affected-tests.ts";
import { type AuthoredTest, removeLaid } from "./check-author.ts";
import { evidenceRef } from "./exchange.ts";
import type { RequirementRecord } from "./requirement-record.ts";
import type { TestConventions } from "./test-conventions.ts";
import { runUserCheck, type UserCheck } from "./user-checks.ts";

/** What the harness measured for one requirement on the tree as it stands. */
export interface RequirementCheck {
  readonly requirement: string;
  /** passing: every independent check of it holds. none: it has no independent check here. */
  readonly status: "passing" | "failing" | "none";
  /** What failed, bounded, or what passed. */
  readonly detail: string;
  readonly evidence: string | null;
}

export interface RegressionCheck {
  /** The whole declared suite, or the tests the change reaches through their imports. */
  readonly scope: "suite" | "affected";
  /** Tests (or checks, where no report was read) that held at the base and do not now. */
  readonly newFailures: readonly string[];
  readonly detail: string;
  readonly evidence: string | null;
}

/**
 * The checks the harness runs on the working tree between the model's turns: each requirement's
 * independent checks (authored tests laid in for their run and taken out again, authored claims,
 * the wording's version constraints), and the base's declared test checks against how they ran at
 * the base. The model never asks for these and never reads the authored tests' source.
 */
export function createTurnChecks(input: {
  readonly chokepoint: Chokepoint;
  readonly workspace: string;
  readonly authored: readonly AuthoredTest[];
  readonly scratch: string;
  /** How one test file runs; null where no runner was recognized, so only the suite runs. */
  readonly conventions: TestConventions | null;
  /** The user's checks (`--accept`), validated at the base. */
  readonly user?: readonly UserCheck[];
}) {
  const { chokepoint, workspace, conventions } = input;
  let suite: readonly DeclaredCheck[] = [];
  let base: (TestReport | number | null)[] = [];
  let runs = 0;
  let suiteRuns = 0;
  /** Tests newly failing as last read, each with the files that run it again. */
  let known = new Map<string, readonly string[]>();
  const user = input.user ?? [];
  const withheld = [
    ...input.authored.map((one) => one.path),
    ...user.flatMap((one) => (one.path === null ? [] : [one.path])),
  ];
  /** The user's behavior-preservation checks that fail now, which passed at the base. */
  const keptFailures = async () => {
    const failing: string[] = [];
    for (const check of user.filter((one) => one.requirement === null)) {
      const ran = await runUserCheck(chokepoint, workspace, check, "kept check");
      if (ran.exitCode !== 0) failing.push(`${check.name} (${check.path ?? check.command})`);
    }
    return failing;
  };

  /** One declared test check with its runner's reporter: the report, or its exit code. */
  const measure = async (check: DeclaredCheck, label: string) => {
    const plans = await reportPlans(workspace, [check]);
    const plan = plans[0] ?? null;
    runs += 1;
    const file = join(input.scratch, `${label}-${runs}.report`);
    await mkdir(dirname(file), { recursive: true });
    await rm(file, { force: true });
    const env = plan === null ? {} : plan.env(file);
    const prefix = Object.entries(env)
      .map(([name, value]) => `${name}='${value.replaceAll("'", "'\\''")}' `)
      .join("");
    const command = plan === null ? check.command : `${prefix}${plan.command(file)}`;
    const ran = await chokepoint.check(command, `${label}: ${check.name}`);
    const text = plan === null ? null : await readFile(file, "utf8").catch(() => null);
    const report =
      plan === null || text === null ? null : parseReport(plan.runner, text, workspace, null);
    return { ran, report };
  };

  return {
    /** Where the authored tests are laid while they run: files the model reads only the results of. */
    withheld,
    /** The declared test checks at the base, before the first edit: what a regression is measured from. */
    async baseline(): Promise<void> {
      suite = (await declaredChecks(workspace)).filter((check) => check.kind === "test");
      base = [];
      suiteRuns += 1;
      for (const check of suite) {
        const { ran, report } = await measure(check, "base");
        base.push(report ?? ran.exitCode);
      }
    },

    /** Each requirement's independent checks on the tree as it stands. */
    async requirements(record: RequirementRecord): Promise<RequirementCheck[]> {
      const results: RequirementCheck[] = [];
      for (const requirement of record.requirements.filter((one) => one.required)) {
        const parts: { ok: boolean; line: string; evidence: string | null }[] = [];
        for (const test of input.authored.filter((one) => one.requirement === requirement.id)) {
          const absolute = join(workspace, test.path);
          await mkdir(dirname(absolute), { recursive: true });
          await writeFile(absolute, test.content);
          const ran = await chokepoint
            .check(test.command, `authored check for ${requirement.id}`)
            .finally(() => removeLaid(workspace, test.path));
          const ok = ran.decision === "allowed" && ran.exitCode === 0;
          parts.push({
            ok,
            line: ok
              ? "its authored test passes"
              : `its authored test fails:\n${excerpt(ran.output)}`,
            evidence: evidenceRef(ran.record),
          });
        }
        for (const check of user.filter((one) => one.requirement === requirement.id)) {
          const ran = await runUserCheck(
            chokepoint,
            workspace,
            check,
            `your check for ${requirement.id}`,
          );
          const ok = ran.decision === "allowed" && ran.exitCode === 0;
          const what = `the user's check ${check.path ?? check.command}`;
          parts.push({
            ok,
            line: ok ? `${what} passes` : `${what} fails:\n${excerpt(ran.output)}`,
            evidence: evidenceRef(ran.record),
          });
        }
        const claims = requirement.evidence.structure.filter(
          (claim) =>
            claim.authority === "independently-generated" || claim.authority === "user-acceptance",
        );
        for (const claim of claims) {
          const read = await structureEvidence(workspace, claim);
          const ok = read.outcome === "observed";
          parts.push({
            ok,
            line: `${read.ref}: ${ok ? "holds" : (read.detail ?? "does not hold")}`,
            evidence: null,
          });
        }
        for (const constraint of requirement.versions) {
          const read = await constraintEvidence(workspace, constraint, undefined);
          // The registry's latest is the verifier's to look up; within the range holds here.
          const ok = read.outcome !== "fail" && !(read.detail ?? "").includes("does not resolve");
          parts.push({ ok, line: `${read.ref}: ${read.detail ?? read.outcome}`, evidence: null });
        }
        results.push({
          requirement: requirement.id,
          status:
            parts.length === 0 ? "none" : parts.every((part) => part.ok) ? "passing" : "failing",
          // What fails first: a stop names the first line, and the model reads it first.
          detail: [...parts.filter((part) => !part.ok), ...parts.filter((part) => part.ok)]
            .map((part) => part.line)
            .join("\n"),
          evidence: parts.find((part) => part.evidence !== null)?.evidence ?? null,
        });
      }
      return results;
    },

    /** The whole declared suite now, against the base: what newly fails. */
    async suite(): Promise<RegressionCheck> {
      const newFailures: string[] = [];
      const files = new Map<string, readonly string[]>();
      suiteRuns += 1;
      let output = "";
      let evidence: string | null = null;
      for (const [at, check] of suite.entries()) {
        const { ran, report } = await measure(check, "suite");
        evidence = evidenceRef(ran.record);
        const before = base[at] ?? null;
        if (report !== null && typeof before === "object" && before !== null) {
          for (const [id, entry] of Object.entries(before)) {
            if (entry.status !== "pass" || report[id]?.status === "pass") continue;
            newFailures.push(id);
            if (entry.file !== null) files.set(id, [testPathOf(entry.file)]);
          }
        } else if (before === 0 && ran.exitCode !== 0) newFailures.push(`check ${check.name}`);
        if (ran.exitCode !== 0) output = excerpt(ran.output, 1200);
      }
      // A failure the report cannot place in a file is read again only by the next whole run.
      known = new Map(
        newFailures.flatMap((id) => (files.has(id) ? [[id, files.get(id) ?? []]] : [])),
      );
      newFailures.push(...(await keptFailures()));
      const none = `the declared tests show no new failure (${suite.map((one) => one.name).join(", ") || "none declared"})`;
      return {
        scope: "suite",
        newFailures,
        detail: failuresDetail(newFailures, output, none),
        evidence,
      };
    },

    /**
     * The tests the files changed since the last measure reach through their imports, with those
     * still newly failing as last read, against how they ran at the base. Null where no runner
     * runs one file or the base gave no per-test report: only the whole suite can say then.
     */
    async affected(changed: readonly string[]): Promise<RegressionCheck | null> {
      const reports = base.filter(
        (one): one is TestReport => typeof one === "object" && one !== null,
      );
      if (conventions === null || reports.length === 0) return null;
      const before = Object.assign({}, ...reports) as TestReport;
      const graph = await importGraph(workspace, changed);
      const isTest = (path: string) =>
        testPattern(conventions).test(path) && !withheld.includes(path);
      const reached = affectedTests(graph, changed, isTest);
      const files = [...new Set([...reached, ...[...known.values()].flat()])].filter((path) =>
        graph.has(path),
      );
      const ids = (inFiles: readonly string[]) =>
        Object.entries(before).filter(
          ([, entry]) =>
            entry.status === "pass" && inFiles.some((path) => livesIn(entry.file, path)),
        );
      if (files.length > 0) {
        const command = conventions.commandFor(files.map(shellWord).join(" "));
        const { ran, report } = await measure(
          { name: "affected", command, kind: "test" },
          "affected",
        );
        for (const [id, entry] of ids(files)) {
          const now = report === null ? (ran.exitCode === 0 ? "pass" : "fail") : report[id]?.status;
          if (now === "pass") known.delete(id);
          else known.set(id, [testPathOf(entry.file ?? "")]);
        }
        const newFailures = [...known.keys(), ...(await keptFailures())];
        const output = ran.exitCode === 0 ? "" : excerpt(ran.output, 1200);
        const none = `the tests your change reaches show no new failure (${files.length} file${files.length === 1 ? "" : "s"})`;
        return {
          scope: "affected",
          newFailures,
          detail: failuresDetail(newFailures, output, none),
          evidence: evidenceRef(ran.record),
        };
      }
      return {
        scope: "affected",
        newFailures: [...known.keys(), ...(await keptFailures())],
        detail: "no test file reaches what changed",
        evidence: null,
      };
    },

    /**
     * Whether a declared test the task bears on failed at the base: a change could make it pass,
     * and witness R1. A failing run with no per-test report cannot say which, so it counts.
     */
    baseFailing: (related: (path: string) => boolean) =>
      base.some((one) =>
        typeof one === "number"
          ? one !== 0
          : one !== null &&
            Object.entries(one).some(
              ([id, entry]) =>
                entry.status === "fail" &&
                related(entry.file === null ? id : testPathOf(entry.file)),
            ),
      ),
    /** How many check commands the harness has run. */
    runs: () => runs,
    /** How many times the whole declared suite ran, the base's run included. */
    suiteRuns: () => suiteRuns,
  };
}

export type TurnChecks = ReturnType<typeof createTurnChecks>;
