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
import { type AuthoredTest, removeLaid } from "./check-author.ts";
import { evidenceRef } from "./exchange.ts";
import type { RequirementRecord } from "./requirement-record.ts";

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
  /** Tests (or checks, where no report was read) that held at the base and do not now. */
  readonly newFailures: readonly string[];
  readonly detail: string;
  readonly evidence: string | null;
}

// Runners colour their output; the escape is built, since a literal one in a pattern hides.
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const excerpt = (text: string, bytes = 1800) => {
  const plain = text.replace(ansi, "");
  return plain.length <= bytes ? plain : `...${plain.slice(-bytes)}`;
};

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
}) {
  const { chokepoint, workspace } = input;
  let suite: readonly DeclaredCheck[] = [];
  let base: (TestReport | number | null)[] = [];
  let runs = 0;

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
    /** The declared test checks at the base, before the first edit: what a regression is measured from. */
    async baseline(): Promise<void> {
      suite = (await declaredChecks(workspace)).filter((check) => check.kind === "test");
      base = [];
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
        const claims = requirement.evidence.structure.filter(
          (claim) => claim.authority === "independently-generated",
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

    /** The declared test checks now, against the base: what newly fails. */
    async regression(): Promise<RegressionCheck> {
      const newFailures: string[] = [];
      let output = "";
      let evidence: string | null = null;
      for (const [at, check] of suite.entries()) {
        const { ran, report } = await measure(check, "suite");
        evidence = evidenceRef(ran.record);
        const before = base[at] ?? null;
        if (report !== null && typeof before === "object" && before !== null) {
          for (const [id, entry] of Object.entries(before)) {
            if (entry.status === "pass" && report[id]?.status !== "pass") newFailures.push(id);
          }
        } else if (before === 0 && ran.exitCode !== 0) newFailures.push(`check ${check.name}`);
        if (ran.exitCode !== 0) output = excerpt(ran.output, 1200);
      }
      const detail =
        newFailures.length === 0
          ? `the declared tests show no new failure (${suite.map((one) => one.name).join(", ") || "none declared"})`
          : `newly failing: ${newFailures.slice(0, 12).join(", ")}${newFailures.length > 12 ? ` and ${newFailures.length - 12} more` : ""}\n${output}`;
      return { newFailures, detail, evidence };
    },

    /** How many check commands the harness has run. */
    runs: () => runs,
  };
}

export type TurnChecks = ReturnType<typeof createTurnChecks>;
