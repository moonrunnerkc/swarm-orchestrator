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
}

const proposalSchema = z.array(
  z.looseObject({
    id: z.string(),
    text: z.string(),
  }),
);

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export function initialRecord(
  task: string,
  versions: readonly VersionConstraint[] = [],
  notes: readonly string[] = [],
): RequirementRecord {
  return {
    requirements: [
      requirementSchema.parse({ id: "R1", text: task, source: "user", kind: "other", versions }),
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
  const held = record.requirements.find((one) => one.id === "R1")?.versions ?? [];
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
    accepted.set(parsed.data.id, parsed.data);
  }
  const first = accepted.get("R1") ?? record.requirements.find((one) => one.id === "R1");
  const rest = [...accepted.values()].filter((one) => one.id !== "R1");
  return { requirements: first === undefined ? rest : [first, ...rest], notes };
}

/** A digest of the record, bound into the signed statement so a report cannot swap it. */
export function recordSha256(record: RequirementRecord): string {
  return createHash("sha256").update(JSON.stringify(record.requirements)).digest("hex");
}
