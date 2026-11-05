import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import type { ModelClient } from "./model.ts";
import type { RequirementRecord } from "./requirement-record.ts";
import type { TurnChecks } from "./turn-checks.ts";

/** One verification of the working tree, as the loop reads it. */
export interface Verification {
  readonly state: "complete" | "incomplete" | "blocked";
  /** The digest of the exact patch the verifier measured. */
  readonly patchSha256: string;
  /** The digest of the requirement record it judged. */
  readonly recordSha256: string;
  /** What the verifier found, for the model to act on: requirement statuses, reasons, output. */
  readonly feedback: string;
  /** The tree and record were those of the held result, which was returned without a new run. */
  readonly reused?: boolean;
  /** The verifier's reasons, the first of which says why a blocked verification is blocked. */
  readonly reasons?: readonly string[];
  /**
   * Nothing stands between the tree and completion but evidence the model cannot write: every
   * required requirement satisfied or self-attested, nothing regressed.
   */
  readonly independenceMissing?: boolean;
}

export interface LoopOptions {
  readonly task: string;
  readonly model: ModelClient;
  readonly chokepoint: Chokepoint;
  readonly evidence: EvidenceRecorder;
  /** The machine the model's commands run on, probed at session start (platform-facts.ts). */
  readonly environment: string;
  /** Repository instructions as the model reads them, or "" where there are none. */
  readonly instructions: string;
  readonly record: RequirementRecord;
  /** `git status --short` of the working tree, read fresh every turn. */
  readonly status: () => Promise<string>;
  /** The working tree's change against the base, as the verifier would read it, every turn. */
  readonly diff: () => Promise<string>;
  readonly verify: (record: RequirementRecord) => Promise<Verification>;
  /** The harness's own checks of the tree after every change; null runs none (a test's loop). */
  readonly checks?: TurnChecks | null;
  readonly maxSteps: number;
  readonly maxTokens: number;
  /** The completion cap of one turn; a turn never asks for more than the run has left. */
  readonly turnTokens: number;
  /**
   * The time left for model turns with final verification still reserved, and the run's whole
   * wall budget; both infinite where the run has none.
   */
  readonly turnTime: () => { readonly leftMs: number; readonly wallMs: number };
  /** The model's context window, which compaction keeps the prompt within. */
  readonly contextTokens: number;
  /**
   * Where full command outputs are copied for the model to read again, inside the workspace it
   * may read, and the workspace root that paths are shown relative to.
   */
  readonly outputs: { readonly directory: string; readonly root: string };
  /** What a model taking over from another reads first, or null for a fresh start. */
  readonly handoff?: string | null;
  /**
   * The tree a reopened loop starts on, already judged complete before a review reopened it: the
   * harness does not verify it again until it changes.
   */
  readonly settled?: string | null;
  readonly signal?: AbortSignal | undefined;
  readonly log: (line: string) => void;
}

export type StopReason =
  | "complete"
  | "incomplete"
  | "blocked"
  | "no-progress"
  | "step-budget"
  | "token-budget"
  | "time-budget"
  | "model-error"
  | "unusable-replies";

/** One model turn's token counts, each either reported by the runtime or estimated from text. */
export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The runtime's time reading the prompt and writing the reply, where it reported them. */
  readonly prefillMs?: number | null;
  readonly generationMs?: number | null;
  readonly inputCount: "reported" | "estimated";
  readonly outputCount: "reported" | "estimated";
}

/** What the model turns cost, input and output apart, and which counts were estimated. */
export interface Usage {
  readonly turns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Turns where the runtime reported no count and the loop estimated it from the text. */
  readonly estimatedTurns: number;
  /** Inference time the runtime reported; turns that reported none are not in it. */
  readonly inferenceMs: number;
  /** Turns whose inference time the runtime reported. */
  readonly inferenceTurns: number;
  /** Requests the client sent again after a transient failure. */
  readonly retries: number;
  /** Every turn's counts in order, so a prompt that grows with the run shows as it grows. */
  readonly perTurn: readonly TurnUsage[];
}

export interface LoopResult {
  readonly stop: StopReason;
  /** Why a run stopped where the reason alone does not say. */
  readonly reason: string | null;
  readonly record: RequirementRecord;
  /** The last verification, or null where none ran. Finalization decides whether it is stale. */
  readonly verification: Verification | null;
  readonly steps: number;
  readonly usage: Usage;
  readonly verifications: number;
  /** Where the turns went: each charged to the requirement whose checks were failing. */
  readonly turnsByRequirement: Readonly<Record<string, number>>;
  /** Check commands the harness ran, apart from the model's turns. */
  readonly harnessChecks: number;
  /** The model's own commands that ran a test runner. */
  readonly modelTestCommands: number;
}
