import { z } from "zod";
import { digestPattern } from "../evidence/canonical-json.ts";
import {
  type ExperimentIdentity,
  identifiedRowSchema,
  MixedProtocolGenerations,
} from "./reach-pressure-analysis.ts";

/**
 * Keeping what a run observed apart from what a later checkout concluded from it.
 *
 * Generation 3's report was derived by sources that differed from the ones its protocol
 * registered, and said so in one sentence. That sentence is honest only if nothing a later
 * analysis does can pass for the run's own output. So the parts of the experiment that can each
 * change a reading carry their own identity, a published summary is never overwritten by
 * different bytes, and every derivation writes down what it was derived from, what it was derived
 * with, and which values moved.
 */

/**
 * The sources behind each identity. One file can sit under two: the judge both produces the
 * visible observations and settles the held-back score.
 *
 * - acquisition: what ran a task, applied the treatment and recorded an observation
 * - scoring: what turned a stored patch into a held-back pass or fail
 * - analysis: what turned rows into the summary's numbers
 * - renderer: what turned the summary into prose
 */
export const identitySources = {
  acquisition: [
    "scripts/reach-pressure-experiment.mjs",
    "scripts/reach-pressure/scripted-agent.mjs",
    "src/eval/endpoint-health.ts",
    "src/eval/oracle-filter.ts",
    "src/eval/patch-metrics.ts",
    "src/eval/pr-task-judge.ts",
    "src/eval/reach-pressure.ts",
    "src/eval/repair-progress.ts",
    "src/eval/sealed-workspace.ts",
    "src/gates/certification.ts",
    "src/gates/file-set.ts",
    "src/gates/oracle-reach.ts",
  ],
  scoring: [
    "src/eval/oracle-filter.ts",
    "src/eval/pr-task-judge.ts",
    "src/eval/reach-pressure-analysis.ts",
  ],
  analysis: [
    "src/eval/known-total.ts",
    "src/eval/reach-pressure-analysis.ts",
    "src/eval/repair-progress.ts",
    "src/eval/statistics.ts",
  ],
  renderer: ["src/eval/reach-pressure-report.ts"],
} as const;
export type IdentityComponent = keyof typeof identitySources;

const componentDigests = z.object({
  acquisition: z.string().regex(digestPattern),
  scoring: z.string().regex(digestPattern),
  analysis: z.string().regex(digestPattern),
  renderer: z.string().regex(digestPattern),
});
export type ComponentDigests = z.infer<typeof componentDigests>;

/** Every leaf where two JSON values disagree, as JSON pointers, sorted. */
export function jsonDifference(
  published: unknown,
  derived: unknown,
): {
  readonly changed: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
} {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] =>
    typeof value === "object" && value !== null;
  const walk = (left: unknown, right: unknown, pointer: string): void => {
    if (isContainer(left) && isContainer(right) && Array.isArray(left) === Array.isArray(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of [...keys].sort()) {
        const at = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        const inLeft = Object.hasOwn(left, key);
        const inRight = Object.hasOwn(right, key);
        // A subtree only one side holds is named once, at its root.
        if (!inLeft) added.push(at);
        else if (!inRight) removed.push(at);
        else
          walk((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], at);
      }
      return;
    }
    if (JSON.stringify(left) !== JSON.stringify(right))
      changed.push(pointer === "" ? "/" : pointer);
  };
  walk(published, derived, "");
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}

export const derivationRecordSchema = z.object({
  schema: z.literal("swarm.reach-pressure.derivation.v1"),
  /** What produced the rows. Read off the rows and the registered protocol, never recomputed. */
  acquisition: z.object({
    generation: z.number().int().positive(),
    protocolDigest: z.string().regex(digestPattern),
    manifestDigest: z.string().regex(digestPattern),
    driverDigest: z.string().regex(digestPattern),
    policyDigest: z.string().regex(digestPattern),
    harness: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  /** What produced this summary and page. */
  derivation: z.object({
    components: componentDigests,
    /** The registered protocol's own digest formula over the sources as they stand now. */
    driverSourcesDigest: z.string().regex(digestPattern),
    matchesRegisteredDriver: z.boolean(),
  }),
  /** The observations, by digest. A derivation reads them and writes none of them. */
  historicalObservations: z.object({
    unchangedByThisDerivation: z.array(z.string()),
    results: z.string().regex(digestPattern),
    hiddenScores: z.string().regex(digestPattern).nullable(),
  }),
  rederivedFields: z.array(z.string()),
  summaryDigest: z.string().regex(digestPattern),
  /** Null where no summary had been published for these rows. */
  againstPublished: z
    .object({
      summaryDigest: z.string().regex(digestPattern),
      identical: z.boolean(),
      /** Whether any value both summaries carry differs. New fields are not a changed result. */
      resultChanged: z.boolean(),
      changed: z.array(z.string()),
      added: z.array(z.string()),
      removed: z.array(z.string()),
    })
    .nullable(),
});
export type DerivationRecord = z.infer<typeof derivationRecordSchema>;

export function derivationRecord(input: {
  readonly acquisition: ExperimentIdentity;
  readonly components: ComponentDigests;
  readonly driverSourcesDigest: string;
  readonly resultsDigest: string;
  readonly hiddenScoresDigest: string | null;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly summaryDigest: string;
  readonly published: { readonly summary: unknown; readonly digest: string } | null;
}): DerivationRecord {
  const difference =
    input.published === null ? null : jsonDifference(input.published.summary, input.summary);
  return derivationRecordSchema.parse({
    schema: "swarm.reach-pressure.derivation.v1",
    acquisition: input.acquisition,
    derivation: {
      components: input.components,
      driverSourcesDigest: input.driverSourcesDigest,
      matchesRegisteredDriver: input.driverSourcesDigest === input.acquisition.driverDigest,
    },
    historicalObservations: {
      unchangedByThisDerivation: [
        "results.jsonl",
        "hidden-scores.jsonl",
        "manifest.json",
        "protocol.md",
        "patches/",
      ],
      results: input.resultsDigest,
      hiddenScores: input.hiddenScoresDigest,
    },
    // Everything in a summary is derived. Its keys are listed so the record says so in its own words.
    rederivedFields: Object.keys(input.summary).sort(),
    summaryDigest: input.summaryDigest,
    againstPublished:
      input.published === null || difference === null
        ? null
        : {
            summaryDigest: input.published.digest,
            identical: input.published.digest === input.summaryDigest,
            // The schema label names the summary's shape and is not a result of the run.
            resultChanged:
              difference.changed.some((pointer) => pointer !== "/schema") ||
              difference.removed.length > 0,
            ...difference,
          },
  });
}

export class PublishedSummaryWouldChange extends Error {
  constructor(record: DerivationRecord) {
    const against = record.againstPublished;
    super(
      "a summary is already published for these rows and this checkout derives different bytes " +
        `(${against?.changed.length ?? 0} value(s) changed, ${against?.added.length ?? 0} added, ` +
        `${against?.removed.length ?? 0} removed). A published derivation is not overwritten: ` +
        "write this one beside it with --out <directory>, where its derivation record says what moved.",
    );
    this.name = "PublishedSummaryWouldChange";
  }
}

/**
 * Where a derivation may be written. In place only where nothing is published yet or the bytes
 * are the ones already there; anywhere else the caller must have named a separate directory.
 */
export function derivationDestination(input: {
  readonly record: DerivationRecord;
  readonly evidenceRoot: string;
  readonly requestedOut: string | null;
}): string {
  if (input.requestedOut !== null) return input.requestedOut;
  const against = input.record.againstPublished;
  if (against !== null && !against.identical) throw new PublishedSummaryWouldChange(input.record);
  return input.evidenceRoot;
}

/**
 * Every row already in an evidence directory, held to the identity about to write beside it.
 *
 * `analyze` has always refused mixed rows. `run` and `score` did not look: a results file left in
 * place across a protocol change would have had its settled tasks skipped as settled and its
 * open ones continued under the new generation, and the mix would surface only at analysis, after
 * the cohort had been spent. Generations 1 and 2 were kept apart by moving files by hand.
 */
export function assertOneAcquisition(
  identity: ExperimentIdentity,
  rawRows: readonly unknown[],
): void {
  // Identity first and nothing else: an older generation's row need not parse as today's.
  const rows = rawRows.map((row) => identifiedRowSchema.parse(row));
  const keys = [
    "generation",
    "protocolDigest",
    "manifestDigest",
    "driverDigest",
    "policyDigest",
    "harness",
  ] as const;
  const foreign = rows.filter((row) => keys.some((key) => row[key] !== identity[key]));
  if (foreign.length === 0) return;
  throw new MixedProtocolGenerations([
    ...new Set(
      foreign.map(
        (row) =>
          `${row.taskId} generation ${row.generation} ${row.harness} (differs in ${keys
            .filter((key) => row[key] !== identity[key])
            .join(", ")})`,
      ),
    ),
  ]);
}

/**
 * What to do with one task on a run or a resume, from the rows alone.
 *
 * A launch with no result is a driver that stopped mid-task: the attempt is closed as the
 * infrastructure failure it was before anything else happens, so it is kept and never repeated
 * under the same attempt number. A settled task is never dispatched again, which is what makes a
 * resume unable to duplicate an observation.
 */
export interface TaskSchedule {
  readonly action: "settled" | "exhausted" | "dispatch";
  /** The attempt number to run next, for `dispatch` only. */
  readonly attempt: number | null;
  /** A launch that never settled, to be closed as an infrastructure failure before anything else. */
  readonly closeDangling: { readonly attempt: number; readonly startedAt: string } | null;
}

export function scheduleOf(input: {
  readonly launches: readonly { readonly attempt: number; readonly startedAt: string }[];
  readonly results: readonly { readonly trajectory: { readonly status: string } }[];
  readonly attemptsPerTask: number;
}): TaskSchedule {
  const { launches, results, attemptsPerTask } = input;
  const unsettled = launches.length > results.length ? (launches.at(-1) ?? null) : null;
  const closeDangling =
    unsettled === null ? null : { attempt: launches.length, startedAt: unsettled.startedAt };
  const attempts = results.length + (closeDangling === null ? 0 : 1);
  const last = closeDangling === null ? results.at(-1) : undefined;
  if (last !== undefined && last.trajectory.status !== "infrastructure-failure") {
    return { action: "settled", attempt: null, closeDangling };
  }
  // A task that keeps taking the server down stays an infrastructure failure by name rather than
  // being scheduled until it happens to survive.
  if (attempts >= attemptsPerTask) return { action: "exhausted", attempt: null, closeDangling };
  return { action: "dispatch", attempt: attempts + 1, closeDangling };
}
