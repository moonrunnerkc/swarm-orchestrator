import type { VerifyResult } from "swarm-verify";
import type { ApprovalMode, ConfirmationPrompt } from "../tools/chokepoint.ts";
import type { Escalate } from "./attempts.ts";
import type { ChecksMode } from "./check-gate.ts";
import type { StopReason } from "./loop.ts";
import type { ModelClient } from "./model.ts";
import type { RunReportFile } from "./report.ts";
import type { Supplied } from "./supplied.ts";

export interface RunOptions {
  readonly workspace: string;
  readonly task: string;
  readonly model: ModelClient;
  /** Why this model, in one line, for the report. */
  readonly modelReason: string;
  /**
   * Whom to hand the run to once, when this model stops making progress on a task of a kind:
   * a model with a better record on that kind here, or none, with why.
   */
  readonly escalation?: Escalate | null;
  /** The money a turn costs where it is known; "none (local runtime)" for a local model. */
  readonly cost: string;
  readonly contextTokens: number;
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly turnTokens: number;
  /** One wall-time budget for the whole run, final verification included; null for none. */
  readonly maxWallMs: number | null;
  /** Where the verifier runs the checks: a container (the default), or the host, reported so. */
  readonly isolation: "isolated" | "host";
  /** On the host, verify with the workspace's installed dependencies, reported as not reproducible. */
  readonly dependencies?: "linked";
  /** Whether to apply the delivered patch to the workspace when it is still as the run found it. */
  readonly apply: boolean;
  readonly approval: ApprovalMode;
  /** The user's authorization to change what existing tests expect; never the model's. */
  readonly behaviorChange?: "none" | "authorized";
  /** One fresh-context review of a completed change; off unless asked for. */
  readonly review?: boolean;
  /** The user's own checks (`--accept`, `--accept-cmd`), read before the workspace opens. */
  readonly supplied?: readonly Supplied[];
  /** What happens to the author's checks; used as written where not said. */
  readonly checksMode?: ChecksMode;
  readonly confirm: ConfirmationPrompt;
  readonly version: string;
  readonly signal?: AbortSignal | undefined;
  readonly log: (line: string) => void;
}

export interface RunReport {
  readonly stop: StopReason | "cancelled" | "interrupted";
  readonly report: RunReportFile;
  readonly sessionDirectory: string;
  readonly reportPath: string;
  readonly result: VerifyResult | null;
}
