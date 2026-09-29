import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { asJsonValue } from "../evidence/canonical-json.ts";
import {
  declareDerivedGoalContract,
  type GoalCheckDefinition,
  type GoalContract,
  goalImmutablePaths,
} from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { contractPath } from "../evidence/task-contract.ts";
import type { GoalVerification } from "./goal-acceptance.ts";
import type { Mutant } from "./oracle-mutants.ts";

/**
 * Admitting an additive check to a requirement a challenge showed was under-checked.
 *
 * A proposed check is a claim. It is admitted on observations the harness makes, never on a
 * model's say-so: run under a one-check probe contract, it must reject the counterexample that
 * exposed the gap (the candidate with the surviving mutant, or the sealed fixture) and accept
 * every sealed reference implementation of that requirement. The references are what justify
 * the expected result: without one, nothing says what correct code does, and nothing is
 * admitted. The candidate is run too and recorded, but it is not asked to pass: a sound new check
 * may fail the candidate, which is what the repair that follows is for.
 */
export const proposalRule = "check-proposal-v1";
export const admissionRule = "check-admission-v1";

export const proposedCheckSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  command: z.string().min(1).max(8192),
  artifacts: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(512),
        content: z.string().min(1).max(200_000),
      }),
    )
    .min(1)
    .max(8),
  rationale: z.string().min(1).max(4000),
});
export type ProposedCheck = z.infer<typeof proposedCheckSchema>;

export type Counterexample =
  | { readonly kind: "mutant"; readonly mutant: Mutant }
  | { readonly kind: "fixture"; readonly id: string; readonly patch: string }
  /** The tree before the work, where the checks accepted it: a change that does nothing. */
  | { readonly kind: "base"; readonly paths: readonly string[] };

export interface AdmissionRun {
  readonly purpose: "counterexample" | "reference" | "candidate";
  readonly reference: string | null;
  /** The goal-verification record the probe run wrote, which the offline verifier re-derives. */
  readonly verification: string | null;
  readonly status: "accepted" | "rejected" | "unjudged";
}

/** The check a proposal becomes: model-authored, shared, its artifacts at normalized paths. */
export function proposedDefinition(proposal: ProposedCheck): GoalCheckDefinition {
  return {
    id: proposal.id,
    command: proposal.command,
    author: "model",
    exposure: "shared",
    artifacts: proposal.artifacts.map((artifact) => ({
      path: contractPath(artifact.path),
      content: artifact.content,
    })),
  };
}

/** Why a proposal cannot be run at all, before any process is spent on it; null where it can. */
export function proposalProblem(
  parent: GoalContract,
  requirement: string,
  proposal: ProposedCheck,
  changedPaths: readonly string[],
): string | null {
  if (!parent.requirements.some((one) => one.id === requirement))
    return `requirement ${requirement} is not in the contract`;
  if (parent.checks.some((check) => check.id === proposal.id))
    return `check ${proposal.id} already exists; an additive check takes a new identity`;
  let paths: string[];
  try {
    paths = proposal.artifacts.map((artifact) => contractPath(artifact.path));
  } catch (cause) {
    return `an artifact path is unsafe: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  if (new Set(paths).size !== paths.length) return "two artifacts share a path";
  const pinned = new Set(goalImmutablePaths(parent));
  const collision = paths.find((path) => pinned.has(path) || changedPaths.includes(path));
  if (collision !== undefined)
    return `artifact ${collision} would overwrite a pinned acceptance file or a file the change touches`;
  return null;
}

/** The one-check contract a proposal is run under: its requirement, and nothing else. */
export function probeContract(
  parent: GoalContract,
  requirement: string,
  check: GoalCheckDefinition,
): GoalContract {
  const source = parent.requirements.find((one) => one.id === requirement);
  if (source === undefined) throw new Error(`requirement ${requirement} is not in the contract`);
  return {
    version: 1,
    goal: parent.goal,
    requirements: [{ id: source.id, description: source.description, checks: [check.id] }],
    checks: [check],
    immutablePaths: [...goalImmutablePaths(parent)],
    selection: "stable",
  };
}

/**
 * The admission rule, on the three kinds of run. Mirrored in the dependency-free verifier
 * (`src/evidence/verifier/strengthening.mjs`), which re-derives each status from the probe's own
 * goal-verification record.
 */
export function admissionDecision(
  runs: readonly AdmissionRun[],
  references: readonly string[],
): { readonly admitted: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  const counterexample = runs.filter((run) => run.purpose === "counterexample");
  if (counterexample.length !== 1) reasons.push("the counterexample was not run exactly once");
  else if (counterexample[0]?.status !== "rejected")
    reasons.push(
      `the check did not reject the counterexample (${counterexample[0]?.status}), so it does not detect the fault that exposed the gap`,
    );
  if (references.length === 0)
    reasons.push(
      "no sealed reference implementation for this requirement, so nothing justifies what the check expects of correct code",
    );
  for (const reference of references) {
    const run = runs.filter((one) => one.purpose === "reference" && one.reference === reference);
    if (run.length !== 1) reasons.push(`reference ${reference} was not run exactly once`);
    else if (run[0]?.status !== "accepted")
      reasons.push(
        `reference ${reference} is ${run[0]?.status}, so the check rejects work the contract's author vouches is correct`,
      );
  }
  if (runs.filter((run) => run.purpose === "candidate").length !== 1)
    reasons.push("the candidate was not run exactly once");
  return { admitted: reasons.length === 0, reasons };
}

const runGit = promisify(execFile);

/**
 * The candidate with the counterexample applied, as one patch on the base: the surviving mutant
 * written into the candidate's file, or the sealed fixture applied over the candidate.
 */
export async function counterexamplePatch(options: {
  readonly repositoryRoot: string;
  readonly baseCommit: string;
  readonly candidatePatch: string;
  readonly counterexample: Counterexample;
}): Promise<string> {
  if (options.counterexample.kind === "base") return "";
  const scratch = await mkdtemp(join(tmpdir(), "swarm-counterexample-"));
  const git = async (args: readonly string[], cwd = join(scratch, "tree")) =>
    (await runGit("git", [...args], { cwd, maxBuffer: 64_000_000 })).stdout;
  try {
    await git(
      ["clone", "--quiet", "--no-hardlinks", "--no-checkout", options.repositoryRoot, "tree"],
      scratch,
    );
    await git([
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "--quiet",
      "--detach",
      options.baseCommit,
    ]);
    const apply = async (patch: string, name: string) => {
      if (patch.trim().length === 0) return;
      const file = join(scratch, name);
      await writeFile(file, patch.endsWith("\n") ? patch : `${patch}\n`);
      await git(["apply", "--whitespace=nowarn", file]);
    };
    await apply(options.candidatePatch, "candidate.patch");
    if (options.counterexample.kind === "fixture")
      await apply(options.counterexample.patch, "fixture.patch");
    else {
      const { path, line, before, after } = options.counterexample.mutant;
      const file = join(scratch, "tree", contractPath(path));
      const lines = (await readFile(file, "utf8")).split("\n");
      if (lines[line - 1] !== before)
        throw new Error(
          `mutant ${options.counterexample.mutant.id} no longer matches line ${line} of ${path}`,
        );
      lines[line - 1] = after;
      await writeFile(file, lines.join("\n"));
    }
    await git(["add", "--all"]);
    return await git(["diff", "--cached", "--binary", options.baseCommit]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** One probe run: the patch on a fresh checkout of the base, the probe contract judged there. */
export type ProbeVerifier = (
  patch: string,
  contract: GoalContract,
) => Promise<GoalVerification | undefined>;

/**
 * Declare the probe, run the proposal against the counterexample, every reference and the
 * candidate, and record the decision. The intent is on the chain before the first run, so an
 * interrupted admission is visible on resume and is never silently repeated.
 */
export async function admitCheck(options: {
  readonly evidence: EvidenceRecorder;
  readonly parent: { readonly contract: GoalContract; readonly digest: string };
  readonly requirement: string;
  readonly proposal: ProposedCheck;
  readonly proposalRecord: string;
  readonly candidatePatch: string;
  readonly counterexamplePatch: string;
  readonly verify: ProbeVerifier;
}): Promise<{
  readonly admitted: boolean;
  readonly reasons: readonly string[];
  readonly runs: readonly AdmissionRun[];
  readonly check: GoalCheckDefinition;
  readonly record: string;
}> {
  const check = proposedDefinition(options.proposal);
  const probe = await declareDerivedGoalContract(
    options.evidence,
    probeContract(options.parent.contract, options.requirement, check),
    {
      role: "admission-probe",
      parent: options.parent.digest,
      requirement: options.requirement,
      proposal: options.proposalRecord,
    },
  );
  const references = (options.parent.contract.challenges?.references ?? []).filter(
    (reference) => reference.requirement === options.requirement,
  );
  await options.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      rule: admissionRule,
      phase: "intent",
      proposal: options.proposalRecord,
      probe: probe.digest,
      references: references.map((reference) => reference.id),
    }),
  });
  const runs: AdmissionRun[] = [];
  const probeRun = async (
    purpose: AdmissionRun["purpose"],
    reference: string | null,
    patch: string,
  ) => {
    const verification = await options.verify(patch, probe.contract);
    const written = options.evidence
      .records()
      .filter(
        (entry) =>
          entry.type === "goal-verification" &&
          (options.evidence.payloads().get(entry.payloadDigest) as GoalVerification | undefined)
            ?.contractDigest === probe.digest,
      )
      .at(-1);
    const status =
      verification === undefined
        ? ("unjudged" as const)
        : (verification.obligations[0]?.status ?? ("unjudged" as const));
    runs.push({ purpose, reference, verification: written?.payloadDigest ?? null, status });
  };
  await probeRun("counterexample", null, options.counterexamplePatch);
  for (const reference of references) await probeRun("reference", reference.id, reference.patch);
  await probeRun("candidate", null, options.candidatePatch);
  const decision = admissionDecision(
    runs,
    references.map((reference) => reference.id),
  );
  const recorded = await options.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      rule: admissionRule,
      phase: "completed",
      proposal: options.proposalRecord,
      probe: probe.digest,
      requirement: options.requirement,
      check,
      references: references.map((reference) => reference.id),
      runs,
      admitted: decision.admitted,
      reasons: decision.reasons,
    }),
  });
  return { ...decision, runs, check, record: recorded.record.payloadDigest };
}
