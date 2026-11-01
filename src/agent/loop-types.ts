import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import type { ModelClient } from "./model.ts";
import type { RequirementRecord } from "./requirement-record.ts";

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
}

export interface LoopOptions {
  readonly task: string;
  readonly model: ModelClient;
  readonly chokepoint: Chokepoint;
  readonly evidence: EvidenceRecorder;
  /** Repository instructions as the model reads them, or "" where there are none. */
  readonly instructions: string;
  readonly record: RequirementRecord;
  /** `git status --short` of the working tree, read fresh every turn. */
  readonly status: () => Promise<string>;
  readonly verify: (record: RequirementRecord) => Promise<Verification>;
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
  /** Where full command outputs are written, or null to keep only what a turn carries. */
  readonly outputs: { readonly directory: string; readonly root: string } | null;
  /** What a model taking over from another reads first, or null for a fresh start. */
  readonly handoff?: string | null;
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
}
