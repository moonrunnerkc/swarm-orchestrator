import type { ProvenanceTag } from "../core/model-client.ts";
import { asJsonValue, type JsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { DerivationAssessment } from "./derivation.ts";
import type { ToolKind } from "./tool-definition.ts";

/**
 * "requested" is written before anything runs, the other three after. Two records per call
 * means a tool that never returns still left evidence that it was invoked.
 */
export type ChokepointDecision = "requested" | "allowed" | "denied" | "failed";

export type ConfirmationReason = "shell-allowlist" | "derivation-heuristic";

/**
 * Why a call was refused, as a value rather than a sentence. A malformed call is the model
 * getting the tool wrong; a guard refusal is the policy saying no to a call that was
 * perfectly well formed. Calibration scores the first and not the second, so the two are
 * kept apart here rather than pattern-matched out of prose later.
 *
 * "guard" was spelled "sandbox" in bundles written before this build. The word was wrong: a
 * lexical path and program policy is a real check and is not containment, and calling it a
 * sandbox is what makes a reader stop asking what it covers. Nothing validates this field when
 * a bundle is read back, so an older bundle still parses and still says what it said; a
 * predicate written against the old spelling keeps evaluating against the old records.
 */
const denialReasons = ["unknown-tool", "invalid-input", "guard", "confirmation-declined"] as const;

export type DenialReason = (typeof denialReasons)[number];

export interface ChokepointRecord {
  readonly callId: string;
  readonly toolName: string;
  readonly kind: ToolKind | "unknown";
  /** Every tag that entered this call, including one added by a derivation match. */
  readonly provenance: readonly ProvenanceTag[];
  readonly decision: ChokepointDecision;
  /** Set exactly when the decision is "denied". */
  readonly denial: DenialReason | null;
  readonly detail: string;
  /** What the model sent, as it sent it, whatever the harness had to decode to read it. */
  readonly input: JsonValue;
  /**
   * Fields whose JSON-string encoding the harness decoded before validating, by dotted path.
   * Empty for the calls that arrived well formed, which is almost all of them. Recorded so a
   * reviewer reads the model's encoding and the harness's reading of it side by side.
   */
  readonly decodedFields: readonly string[];
  readonly output: string;
  readonly facts: Readonly<Record<string, JsonValue>>;
  readonly derivation: DerivationAssessment | null;
}

export interface ConfirmationRecord {
  readonly callId: string;
  readonly toolName: string;
  readonly kind: ToolKind | "unknown";
  readonly reason: ConfirmationReason;
  readonly detail: string;
  readonly approved: boolean;
  readonly derivation: DerivationAssessment | null;
}

/**
 * The chokepoint's write side. Both methods reject rather than swallow: a failed ledger
 * write aborts the run, because a tool call that happened without an evidence record is
 * exactly the state the whole design exists to prevent (invariant 2).
 */
export interface ChokepointRecorder {
  /** Returns the payload digest of the appended record, which is the name a claim cites. */
  recordCall(entry: ChokepointRecord): Promise<string>;
  recordConfirmation(entry: ConfirmationRecord): Promise<void>;
}

export function createLedgerChokepointRecorder(evidence: EvidenceRecorder): ChokepointRecorder {
  return {
    async recordCall(entry: ChokepointRecord): Promise<string> {
      const recorded = await evidence.record({
        type: "tool-call",
        actor: "harness",
        provenance: entry.provenance,
        payload: {
          callId: entry.callId,
          toolName: entry.toolName,
          kind: entry.kind,
          decision: entry.decision,
          denial: entry.denial,
          detail: entry.detail,
          input: entry.input,
          decodedFields: [...entry.decodedFields],
          output: entry.output,
          outputBytes: entry.output.length,
          facts: asJsonValue(entry.facts),
          derivation: asJsonValue(entry.derivation),
        },
      });
      return recorded.record.payloadDigest;
    },

    async recordConfirmation(entry: ConfirmationRecord): Promise<void> {
      await evidence.record({
        type: "confirmation",
        actor: "harness",
        provenance: ["user"],
        payload: {
          callId: entry.callId,
          toolName: entry.toolName,
          kind: entry.kind,
          reason: entry.reason,
          detail: entry.detail,
          outcome: entry.approved ? "approved" : "declined",
          derivation: asJsonValue(entry.derivation),
        },
      });
    },
  };
}
