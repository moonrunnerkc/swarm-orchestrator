import type { ModelRecord, Profile } from "./profile.ts";

/**
 * What a finished run says about its model: it completed the task, it stopped short on its own,
 * or the run ended for a reason that measures nothing about the model.
 */
export type Attribution = "complete" | "model" | "unattributed";

/** The parts of a run report attribution reads. */
export interface FinishedRun {
  readonly state: string;
  readonly verification: string;
  readonly evidenceDelivery: string | null;
  readonly requirements: readonly { readonly status: string }[];
  readonly regression: string | null;
  readonly resources: { readonly escalations: number };
}

/** Stops the user, the endpoint, the clock or the environment caused. */
const notTheModels = new Set(["cancelled", "interrupted", "model-error", "time-budget", "blocked"]);
/** Stops the model reached by its own turns. */
const theModels = new Set(["no-progress", "unusable-replies", "step-budget", "token-budget"]);

/**
 * Attributes a finished run. Only a run whose final verification ran and published its evidence
 * can count for or against the model, and a doubtful case is unattributed: a wrong mark against
 * a model moves selection, and an uncounted run does not.
 */
export function attribute(stop: string, report: FinishedRun): Attribution {
  if (report.resources.escalations > 0) return "unattributed";
  if (report.state === "blocked" || notTheModels.has(stop)) return "unattributed";
  if (report.verification === "not run") return "unattributed";
  if (report.evidenceDelivery !== "signed" && report.evidenceDelivery !== "unsigned")
    return "unattributed";
  if (report.state === "complete") return "complete";
  if (report.state !== "incomplete") return "unattributed";
  if (theModels.has(stop)) return "model";
  // The model marked the task complete and the verifier measured a requirement failed, or a
  // failure the change introduced. A check that is merely missing is not the model's doing, and
  // neither is a failure the base already had.
  const measured =
    report.requirements.some((one) => one.status === "failed") ||
    report.regression?.startsWith("found") === true;
  return stop === "complete" && measured ? "model" : "unattributed";
}

type Tally = {
  readonly complete: number;
  readonly other: number;
  readonly unattributed?: number | undefined;
};
const none: Tally = { complete: 0, other: 0, unattributed: 0 };

function tallied<T extends Tally>(before: T, outcome: Attribution): T {
  if (outcome === "complete") return { ...before, complete: before.complete + 1 };
  if (outcome === "model") return { ...before, other: before.other + 1 };
  return { ...before, unattributed: (before.unattributed ?? 0) + 1 };
}

export function withOutcome(
  profile: Profile,
  digest: string,
  outcome: Attribution,
  kind: string | null = null,
): Profile {
  const before = profile.outcomes[digest] ?? { ...none, legacyOther: 0 };
  const known = before.kinds ?? {};
  const kinds = kind === null ? known : { ...known, [kind]: tallied(known[kind] ?? none, outcome) };
  const after = { ...tallied(before, outcome), kinds };
  return { ...profile, outcomes: { ...profile.outcomes, [digest]: after } };
}

/** Adds one finished run to the model's record in this machine's profile. */
export async function recordOutcome(
  record: ModelRecord,
  digest: string,
  outcome: Attribution,
  kind: string | null = null,
): Promise<void> {
  await record.write(withOutcome(await record.read(), digest, outcome, kind));
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * What a model's record holds beside the counts it is ranked by, for the selection reason and
 * `doctor --models`: runs that are not counted, and counted entries that predate attribution.
 */
export function recordNotes(outcome: Profile["outcomes"][string] | undefined): string[] {
  const unattributed = outcome?.unattributed ?? 0;
  const legacy = outcome?.legacyOther ?? 0;
  return [
    ...(unattributed === 0
      ? []
      : [
          `${unattributed} ${plural(unattributed, "run", "runs")} here ended for reasons not attributed to the model and ${plural(unattributed, "is", "are")} not counted`,
        ]),
    ...(legacy === 0
      ? []
      : [
          `${legacy} of its unfinished tasks ${plural(legacy, "was", "were")} recorded before runs were attributed and ${plural(legacy, "still counts", "still count")}`,
        ]),
  ];
}

/** One line for a model's record here: its counted tasks, then the notes. */
export function describeRecord(outcome: Profile["outcomes"][string] | undefined): string {
  const finished = (outcome?.complete ?? 0) + (outcome?.other ?? 0);
  const counted =
    finished === 0
      ? "no finished tasks recorded here yet"
      : `${outcome?.complete ?? 0} of ${finished} finished ${plural(finished, "task", "tasks")} complete`;
  return [counted, ...recordNotes(outcome)].join("; ");
}
