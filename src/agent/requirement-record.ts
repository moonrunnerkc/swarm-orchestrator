import { createHash } from "node:crypto";
import { type Requirement, requirementSchema, type VersionConstraint } from "swarm-verify";
import { z } from "zod";

/**
 * The run's requirement record. R1 is the user's task, verbatim, and the model can neither drop
 * it nor reword it; the model may propose its kind and evidence, add requirements of its own,
 * and record assumptions. The version constraints the task's wording states are read by code and
 * held on R1 alone. Statuses are never set here: the verifier derives them.
 */
export interface RequirementRecord {
  readonly requirements: readonly Requirement[];
  /** Why parts of the last proposal were not taken, for the model to read. */
  readonly notes: readonly string[];
  /**
   * What the check-authoring stage fixed on R1 before the first edit: its kind and the structure
   * claims written apart from the change. A proposal cannot change or drop either.
   */
  readonly held?: {
    readonly kind: Requirement["kind"];
    readonly structure: readonly Claim[];
    readonly behaviorAsked: boolean;
    /** The user's command checks (`--accept-cmd`) that witness R1, by name. */
    readonly checks?: readonly string[];
  };
}

type Claim = Requirement["evidence"]["structure"][number];

/** R1 with what the authoring stage holds on it laid over whatever was proposed. */
function holding(requirement: Requirement, held: RequirementRecord["held"]): Requirement {
  if (held === undefined) return requirement;
  const own = requirement.evidence.structure.filter(
    (claim) => !held.structure.some((one) => JSON.stringify(one) === JSON.stringify(claim)),
  );
  const checks = [...new Set([...(held.checks ?? []), ...requirement.evidence.checks])];
  return {
    ...requirement,
    kind: held.kind,
    behaviorAsked: held.behaviorAsked,
    evidence: { ...requirement.evidence, structure: [...held.structure, ...own], checks },
  };
}

/** The record with the authoring stage's kind and claims held on R1 from now on. */
export function withAuthored(
  record: RequirementRecord,
  kind: Requirement["kind"],
  structure: readonly Claim[],
  behaviorAsked = false,
  checks: readonly string[] = [],
): RequirementRecord {
  const held = { kind, structure, behaviorAsked, checks };
  return {
    ...record,
    held,
    requirements: record.requirements.map((one) => (one.id === "R1" ? holding(one, held) : one)),
  };
}

/** Claims the coding model proposed are its own, whatever authority the proposal names. */
function stamped(evidence: Requirement["evidence"]): Requirement["evidence"] {
  const own = "implementation-authored" as const;
  return {
    ...evidence,
    structure: evidence.structure.map((claim) => ({ ...claim, authority: own })),
    packages: evidence.packages.map((claim) => ({ ...claim, authority: own })),
  };
}

const proposalSchema = z.array(
  z.looseObject({
    id: z.string(),
    text: z.string(),
  }),
);

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Whether the wording asks for tests: an asking word, then tests ("with a test", "Add tests",
 * "write a regression test"). "the tests stay as they are" and "the test suite must stay green"
 * ask for none.
 */
export function asksForTests(task: string): boolean {
  return /\b(?:add|adds|adding|write|writing|with|include|including)\s+(?:(?:a|an|new|unit|regression|some|more)\s+)*tests?\b/i.test(
    task,
  );
}

export function initialRecord(
  task: string,
  versions: readonly VersionConstraint[] = [],
  notes: readonly string[] = [],
): RequirementRecord {
  const testsAsked = asksForTests(task);
  return {
    requirements: [
      requirementSchema.parse({
        id: "R1",
        text: task,
        source: "user",
        kind: "other",
        versions,
        testsAsked,
      }),
    ],
    notes,
  };
}

/**
 * The record after a proposal. R1 keeps the task's wording and source whatever the proposal
 * says; any other requirement claiming to be the user's must quote the task, or it is recorded
 * as inferred. An entry that does not validate is left out with the reason.
 */
export function applyProposal(
  task: string,
  record: RequirementRecord,
  text: string,
): RequirementRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ...record,
      notes: [`the requirements block is not JSON: ${(error as Error).message}`],
    };
  }
  const entries = proposalSchema.safeParse(Array.isArray(raw) ? raw : [raw]);
  if (!entries.success) {
    return {
      ...record,
      notes: ["the requirements block must be a JSON array of objects with id and text"],
    };
  }
  const notes: string[] = [];
  const accepted = new Map<string, Requirement>();
  const r1 = record.requirements.find((one) => one.id === "R1");
  const held = r1?.versions ?? [];
  for (const entry of entries.data) {
    const isTask = entry.id === "R1";
    const versions = isTask ? held : [];
    if (
      entry.versions !== undefined &&
      JSON.stringify(entry.versions) !== JSON.stringify(versions)
    ) {
      notes.push(
        `${entry.id}'s versions come from the task's wording and are kept as read; a proposal cannot change them`,
      );
    }
    const quoted = normalize(task).includes(normalize(entry.text));
    const shaped = {
      ...entry,
      // R1 is the task and decides it; what the model adds records how it split the task.
      required: isTask,
      // Read from the wording by code, like the versions: no proposal sets it.
      testsAsked: isTask ? (r1?.testsAsked ?? false) : false,
      behaviorAsked: isTask ? (r1?.behaviorAsked ?? false) : false,
      versions,
      text: isTask ? task : entry.text,
      source: isTask
        ? "user"
        : entry.source === "user" && !quoted
          ? "inferred"
          : (entry.source ?? "inferred"),
    };
    if (!isTask && entry.source === "user" && !quoted) {
      notes.push(`${entry.id} does not quote the task, so it is recorded as inferred`);
    }
    const parsed = requirementSchema.safeParse(shaped);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      notes.push(
        `${entry.id} was not recorded: ${issue?.path.join(".") || "entry"} ${issue?.message ?? ""}`.trim(),
      );
      continue;
    }
    accepted.set(parsed.data.id, { ...parsed.data, evidence: stamped(parsed.data.evidence) });
  }
  const proposedKind = accepted.get("R1")?.kind;
  if (
    record.held !== undefined &&
    proposedKind !== undefined &&
    proposedKind !== record.held.kind
  ) {
    notes.push(
      `R1's kind is ${record.held.kind}, fixed when its checks were written; a proposal cannot change it`,
    );
  }
  const proposedFirst = accepted.get("R1");
  const first =
    proposedFirst === undefined
      ? record.requirements.find((one) => one.id === "R1")
      : holding(proposedFirst, record.held);
  const rest = [...accepted.values()].filter((one) => one.id !== "R1");
  return {
    requirements: first === undefined ? rest : [first, ...rest],
    notes,
    ...(record.held === undefined ? {} : { held: record.held }),
  };
}

/** A digest of the record, bound into the signed statement so a report cannot swap it. */
export function recordSha256(record: RequirementRecord): string {
  return createHash("sha256").update(JSON.stringify(record.requirements)).digest("hex");
}
