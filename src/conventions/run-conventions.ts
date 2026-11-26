import {
  type ConventionRule,
  type ConventionSet,
  conventionEvidence,
  conventionValues,
  type Requirement,
  requirementSchema,
} from "swarm-verify";
import { gitText } from "../agent/git.ts";
import { conventionLines } from "./learn.ts";
import { effectiveConventions } from "./profile.ts";

/** How a task names a value in its own words, where it asks for one. */
const phrases: Readonly<Record<string, RegExp>> = {
  default: /\bdefault export/i,
  named: /\bnamed export/i,
  snake_case: /\bsnake[_ ]case/i,
  camelCase: /\bcamel ?case/i,
  "kebab-case": /\bkebab[- ]case/i,
  PascalCase: /\bpascal ?case/i,
};

/** The approved conventions one run works under, read once when it starts. */
export interface RunConventions {
  /** The profile as it was snapshotted, for the evidence. */
  readonly profile: { readonly version: string; readonly sha256: string };
  /** The rules this run is checked against. */
  readonly rules: ConventionSet;
  /** What the model reads with the repository's instructions. */
  readonly block: string;
  readonly notes: readonly string[];
}

/**
 * The profile in effect for a repository, snapshotted for one run: a later change to the profile
 * does not reach a run already started. Where the task itself asks for another value of a rule,
 * the task decides and that rule is left out of this run, with a note saying so.
 */
export async function runConventions(
  home: string,
  repository: string,
  task: string,
): Promise<RunConventions | null> {
  const effective = await effectiveConventions(home, repository);
  if (effective === null) return null;
  const rules: Record<string, string | undefined> = { ...effective.rules };
  const notes = effective.conflicts.map((one) => `Conventions: ${one}.`);
  for (const [rule, value] of Object.entries(effective.rules)) {
    if (value === undefined) continue;
    const asked = conventionValues[rule as ConventionRule].find(
      (other) => other !== value && phrases[other]?.test(task) && !phrases[value]?.test(task),
    );
    if (asked === undefined) continue;
    delete rules[rule];
    notes.push(
      `Conventions: the task asks for ${asked} where the approved profile says ${rule}: ${value}; the task decides for this run, and that rule is not checked.`,
    );
  }
  const kept = rules as ConventionSet;
  const lines = conventionLines({ rules: kept, guidance: effective.guidance });
  return {
    profile: { version: effective.version, sha256: effective.sha256 },
    rules: kept,
    notes,
    block:
      lines.length === 0
        ? ""
        : [
            `Coding conventions the user approved (profile ${effective.sha256.slice(0, 12)}). The files you add or change are checked`,
            "against each rule; code that was already there is not yours to answer for. Follow them in",
            "every edit, repairs included. They never outrank the harness's policy or the task's own words.",
            ...lines,
          ].join("\n"),
  };
}

/** The rules as a requirement of their own, fixed before the first edit like the task's. */
export function conventionRequirement(id: string, rules: ConventionSet): Requirement {
  return requirementSchema.parse({
    id,
    text: `The files the change adds or edits follow the approved coding conventions: ${Object.entries(
      rules,
    )
      .map(([rule, value]) => `${rule} ${value}`)
      .join(", ")}`,
    source: "profile",
    kind: "other",
    evidence: { conventions: rules },
  });
}

/** Between turns: each rule on what has changed since the base, as the verifier will read it. */
export async function conventionParts(
  workspace: string,
  base: string,
  rules: ConventionSet,
): Promise<{ ok: boolean; line: string; evidence: null }[]> {
  const tracked = await gitText(workspace, ["diff", "--name-status", "--no-renames", base]);
  const untracked = await gitText(workspace, ["ls-files", "--others", "--exclude-standard"]);
  const changed = [
    ...tracked.split("\n").flatMap((line) => {
      const [status = "", path = ""] = line.split("\t");
      const kind = status === "A" ? "added" : status === "D" ? "deleted" : "modified";
      return path === "" ? [] : [{ path, status: kind } as const];
    }),
    ...untracked
      .split("\n")
      .filter((path) => path !== "" && !path.startsWith(".swarm/"))
      .map((path) => ({ path, status: "added" as const })),
  ];
  const found = await conventionEvidence(rules, {
    dir: workspace,
    readBase: (path) => gitText(workspace, ["show", `${base}:${path}`]).catch(() => null),
    changed,
  });
  return found.map((one) => ({
    ok: one.outcome !== "fail",
    line: `${one.ref}: ${one.outcome === "fail" ? `broken at ${one.detail}` : one.detail}`,
    evidence: null,
  }));
}
