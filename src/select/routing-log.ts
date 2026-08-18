import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { taskClasses } from "./task-class.ts";

/**
 * Version two makes the cost term real: costUsd becomes nullable, with costSource saying
 * where the number came from. Version-one lines hardcoded costUsd to zero whatever the run
 * cost, so they are counted unreadable rather than read as fabricated free runs.
 */
export const routingLogSchemaVersion = 2;

/** How the model was picked, so the log can be read without mistaking its own bias for signal. */
export const assignmentKinds = ["calibration", "ucb", "epsilon", "pinned"] as const;

export type AssignmentKind = (typeof assignmentKinds)[number];

/** Priced from the table, zero because local, or unknown because no rate is known. */
const costSources = ["priced", "local", "unknown"] as const;

export type CostSource = (typeof costSources)[number];

export const rewardEntrySchema = z.object({
  schemaVersion: z.literal(routingLogSchemaVersion),
  /** Milliseconds from the injected clock. */
  recordedAt: z.number().int(),
  sessionId: z.string().min(1),
  taskClass: z.enum(taskClasses),
  model: z.string().min(1),
  assignment: z.enum(assignmentKinds),
  /** Section 3.6's numerics ride along, so an eroded pass is visible in the log itself. */
  ratchet: z.object({
    settled: z.enum(["green", "escalated"]),
    attempts: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    erosions: z.number().int().nonnegative(),
    testsCollected: z.number().nullable(),
    testsDeclared: z.number().nonnegative(),
    assertions: z.number().nonnegative(),
    skipMarkers: z.number().nonnegative(),
    changedLineCoverage: z.number().nullable(),
  }),
  attempts: z.number().int().nonnegative(),
  /** Null when no gate measured it. Zero is a run that produced nothing and scores zero. */
  changedFiles: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().nonnegative(),
  /** Null when the model has no known rate. The reward treats that as neutral, not free. */
  costUsd: z.number().nonnegative().nullable(),
  costSource: z.enum(costSources),
  reward: z.number().min(0).max(1),
  rewardReason: z.string(),
});

export type RewardEntry = z.infer<typeof rewardEntrySchema>;

export interface RoutingLogContents {
  readonly entries: readonly RewardEntry[];
  /** Lines that did not parse or declared another schema version. Reported, never dropped quietly. */
  readonly unreadable: number;
}

interface RoutingLog {
  readonly path: string;
  append(entry: RewardEntry): Promise<void>;
  read(): Promise<RoutingLogContents>;
}

/** Outside every workspace, beside the session store the sandbox already denies (invariant 11). */
export function defaultRoutingLogPath(homeDirectory: string): string {
  return join(homeDirectory, ".swarm", "routing", "rewards.jsonl");
}

interface RoutingLogOptions {
  readonly path: string;
}

/**
 * Append-only JSONL across sessions. Not a ledger: nothing here is evidence, it is the signal
 * the router learns from, so a corrupt line costs accuracy rather than aborting a run. It is
 * still counted, because a log quietly losing rows would look exactly like a quiet log.
 */
export async function openRoutingLog(options: RoutingLogOptions): Promise<RoutingLog> {
  await mkdir(dirname(options.path), { recursive: true });

  return {
    path: options.path,

    async append(entry: RewardEntry): Promise<void> {
      const parsed = rewardEntrySchema.safeParse(entry);
      if (!parsed.success) {
        throw new Error(
          `refusing to write a routing entry that does not match the log schema: ` +
            z.prettifyError(parsed.error),
        );
      }
      await appendFile(options.path, `${JSON.stringify(parsed.data)}\n`, "utf8");
    },

    async read(): Promise<RoutingLogContents> {
      const text = await readFile(options.path, "utf8").catch(() => "");
      const entries: RewardEntry[] = [];
      let unreadable = 0;

      for (const line of text.split("\n")) {
        if (line.trim().length === 0) {
          continue;
        }
        const parsed = parseLine(line);
        if (parsed === null) {
          unreadable += 1;
          continue;
        }
        entries.push(parsed);
      }
      return { entries, unreadable };
    },
  };
}

function parseLine(line: string): RewardEntry | null {
  try {
    const parsed = rewardEntrySchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
