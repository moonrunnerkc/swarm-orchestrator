import { createHash } from "node:crypto";
import { type Requirement, requirementSchema, type VersionConstraint } from "swarm-verify";
import { z } from "zod";

/**
 * The run's requirement record. R1 is the user's task, verbatim. Each obligation after it (R2 and
 * on) is a part of the task the user set apart, in the task's own words: an item of a list the
 * task holds, or a quote given with `--require`. Code reads them before the first edit; from then
 * on they are fixed, and every one is required. The model may propose R1's evidence and add
 * suggestions of its own, which are recorded as inferred and never required. Statuses are never
 * set here: the verifier derives them.
 */
export interface RequirementRecord {
  readonly requirements: readonly Requirement[];
  /** Why parts of the last proposal were not taken, for the model to read. */
  readonly notes: readonly string[];
  /**
   * What the check stage fixed on each required requirement before the first edit, by id: its
   * kind and the checks written or supplied apart from the change. No proposal changes or drops
   * any of it.
   */
  readonly held?: Readonly<Record<string, Held>>;
}

interface Held {
  readonly kind: Requirement["kind"];
  readonly structure: readonly Claim[];
  readonly behaviorAsked: boolean;
  /** The user's command checks (`--accept-cmd`) that witness the requirement, by name. */
  readonly checks: readonly string[];
}

type Claim = Requirement["evidence"]["structure"][number];

/** A requirement with what the check stage holds on it laid over whatever was proposed. */
function holding(requirement: Requirement, held: Held | undefined): Requirement {
  if (held === undefined) return requirement;
  const own = requirement.evidence.structure.filter(
    (claim) => !held.structure.some((one) => JSON.stringify(one) === JSON.stringify(claim)),
  );
  const checks = [...new Set([...held.checks, ...requirement.evidence.checks])];
  return {
    ...requirement,
    kind: held.kind,
    behaviorAsked: held.behaviorAsked,
    evidence: { ...requirement.evidence, structure: [...held.structure, ...own], checks },
  };
}

/** The record with the check stage's kind and checks held on one requirement from now on. */
export function withAuthored(
  record: RequirementRecord,
  kind: Requirement["kind"],
  structure: readonly Claim[],
  behaviorAsked = false,
  checks: readonly string[] = [],
  id = "R1",
): RequirementRecord {
  const held = { kind, structure, behaviorAsked, checks };
  return {
    ...record,
    held: { ...record.held, [id]: held },
    requirements: record.requirements.map((one) => (one.id === id ? holding(one, held) : one)),
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

const proposalSchema = z.array(z.looseObject({ id: z.string(), text: z.string() }));

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

const listItem = /^[ \t]*(?:[-*\u2022]|\d{1,2}[.)]|\([a-z0-9]{1,2}\)|[a-z]\))[ \t]+(\S.*)$/;

/**
 * The parts of the task the user set apart, each in the task's own words: the items of a list
 * the task holds (two or more lines opening with a bullet or a number), then each quote given
 * with `--require`. A quote the task does not hold is refused: an obligation is the user's
 * wording, never a paraphrase of it. Prose is not split: what a sentence asks for is not
 * something code can read, and R1 holds the whole task either way.
 */
export function obligationsOf(
  task: string,
  quotes: readonly string[] = [],
): { readonly obligations: string[]; readonly refused: string[] } {
  const items = task.split("\n").flatMap((line) => listItem.exec(line)?.[1]?.trim() ?? []);
  const found = items.length >= 2 ? items : [];
  const refused: string[] = [];
  const whole = normalize(task);
  for (const quote of quotes) {
    const text = quote.replace(/\s+/g, " ").trim();
    if (text.length === 0 || !whole.includes(normalize(text)))
      refused.push(`--require ${JSON.stringify(quote)} does not quote the task`);
    else if (normalize(text) === whole)
      refused.push(`--require ${JSON.stringify(quote)} is the whole task, which R1 already is`);
    else found.push(text);
  }
  const obligations = found.filter(
    (one, at) => found.findIndex((other) => normalize(other) === normalize(one)) === at,
  );
  return { obligations, refused };
}

export function initialRecord(
  task: string,
  versions: readonly VersionConstraint[] = [],
  notes: readonly string[] = [],
  obligations: readonly string[] = [],
): RequirementRecord {
  return {
    requirements: [
      requirementSchema.parse({
        id: "R1",
        text: task,
        source: "user",
        kind: "other",
        versions,
        testsAsked: asksForTests(task),
      }),
      ...obligations.map((text, at) =>
        requirementSchema.parse({ id: `R${at + 2}`, text, source: "user", kind: "other" }),
      ),
    ],
    notes,
  };
}

/** Whether a requirement was fixed before the first edit: the task, or one of its obligations. */
const fixed = (one: Requirement) => one.required && one.source === "user";

/**
 * The record after a proposal. R1 keeps the task's wording and source and takes the proposed
 * kind and evidence, under whatever the check stage holds on it. An obligation is kept exactly as
 * it was fixed: a proposal can neither reword, drop nor downgrade it, and leaving it out changes
 * nothing. Anything else the model adds is a suggestion of its own: inferred, never required,
 * and never one of the ids already fixed. An entry that does not validate is left out with why.
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
  const r1 = record.requirements.find((one) => one.id === "R1");
  const obligations = record.requirements.filter((one) => one.id !== "R1" && fixed(one));
  const held = r1?.versions ?? [];
  let first = r1;
  const suggestions = new Map<string, Requirement>();
  for (const entry of entries.data) {
    const isTask = entry.id === "R1";
    const obligation = obligations.find((one) => one.id === entry.id);
    if (obligation !== undefined) {
      if (normalize(entry.text) !== normalize(obligation.text) || entry.required === false)
        notes.push(
          `${entry.id} is part of the task as the user wrote it, fixed before the first edit; a proposal cannot change or drop it`,
        );
      continue;
    }
    const versions = isTask ? held : [];
    if (
      entry.versions !== undefined &&
      JSON.stringify(entry.versions) !== JSON.stringify(versions)
    ) {
      notes.push(
        `${entry.id}'s versions come from the task's wording and are kept as read; a proposal cannot change them`,
      );
    }
    const shaped = {
      ...entry,
      // Only what was fixed before the first edit is required; the rest records the model's split.
      required: isTask,
      // Read from the wording by code, like the versions: no proposal sets it.
      testsAsked: isTask ? (r1?.testsAsked ?? false) : false,
      behaviorAsked: isTask ? (r1?.behaviorAsked ?? false) : false,
      versions,
      text: isTask ? task : entry.text,
      source: isTask ? "user" : "inferred",
    };
    if (!isTask && entry.source === "user")
      notes.push(
        `${entry.id} was added during the work, so it is recorded as your own suggestion (inferred, not required); what the user requires was fixed before the first edit`,
      );
    const parsed = requirementSchema.safeParse(shaped);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      notes.push(
        `${entry.id} was not recorded: ${issue?.path.join(".") || "entry"} ${issue?.message ?? ""}`.trim(),
      );
      continue;
    }
    const taken = { ...parsed.data, evidence: stamped(parsed.data.evidence) };
    if (!isTask) {
      suggestions.set(taken.id, taken);
      continue;
    }
    const fixedKind = record.held?.R1?.kind;
    if (fixedKind !== undefined && taken.kind !== fixedKind)
      notes.push(
        `R1's kind is ${fixedKind}, fixed when its checks were written; a proposal cannot change it`,
      );
    first = holding(taken, record.held?.R1);
  }
  return {
    requirements: [
      ...(first === undefined ? [] : [first]),
      ...obligations,
      ...suggestions.values(),
    ],
    notes,
    ...(record.held === undefined ? {} : { held: record.held }),
  };
}

/** A digest of the record, bound into the signed statement so a report cannot swap it. */
export function recordSha256(record: RequirementRecord): string {
  return createHash("sha256").update(JSON.stringify(record.requirements)).digest("hex");
}
