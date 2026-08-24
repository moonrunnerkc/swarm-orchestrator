import type { ProvenanceTag } from "../core/model-client.ts";
import type { JsonValue } from "./canonical-json.ts";
import {
  type CitedRecord,
  type ClaimEvaluation,
  type ClaimPayload,
  claimPayloadSchema,
  evaluateClaim,
} from "./claim.ts";
import type { LedgerRecord, RecordType } from "./ledger-record.ts";
import { indexCitedRecords } from "./record-index.ts";

export interface EvidenceNode {
  readonly digest: string;
  readonly sequence: number;
  readonly type: RecordType;
  readonly actor: string;
  readonly timestamp: number;
  readonly provenance: readonly ProvenanceTag[];
  readonly summary: string;
  readonly payload: JsonValue | null;
}

export interface ClaimNode {
  readonly sequence: number;
  readonly timestamp: number;
  readonly actor: string;
  readonly predicate: string;
  readonly record: string | null;
  /** The kind of record the claim asserted against, which the verdict below checked. */
  readonly recordKind: string;
  /** Free-text narrative. Always rendered as unverified prose, whatever the verdict is. */
  readonly narrative: string;
  readonly evaluation: ClaimEvaluation;
}

interface EvidenceEdge {
  readonly claimSequence: number;
  readonly record: string;
  /** False when the cited digest matches no record in the chain. */
  readonly resolved: boolean;
}

export interface EvidenceDag {
  readonly claims: readonly ClaimNode[];
  readonly evidence: readonly EvidenceNode[];
  readonly edges: readonly EvidenceEdge[];
  readonly verifiedCount: number;
  readonly unverifiedCount: number;
}

/**
 * Leaves are harness-captured records, interior nodes are claims, edges are citations.
 * Verdicts are recomputed here from the records every time the DAG is built, so a bundle
 * carrying a tampered verdict is caught by the reader rather than believed.
 */
export function buildEvidenceDag(
  records: readonly LedgerRecord[],
  payloads: ReadonlyMap<string, JsonValue>,
): EvidenceDag {
  const claimRecords = records.filter((record) => record.type === "claim");
  const citable = new Set(records.map((record) => record.payloadDigest));
  const cited = indexCitedRecords(records, payloads);
  const lookup = (digest: string): CitedRecord | undefined => cited.get(digest);

  const evidence: EvidenceNode[] = records
    .filter((record) => record.type !== "claim")
    .map((record) => {
      const payload = payloads.get(record.payloadDigest) ?? null;
      return {
        digest: record.payloadDigest,
        sequence: record.sequence,
        type: record.type,
        actor: record.actor,
        timestamp: record.timestamp,
        provenance: record.provenance,
        summary: summarize(record, payload),
        payload,
      };
    });

  const claims: ClaimNode[] = claimRecords.map((record) => {
    const raw = payloads.get(record.payloadDigest);
    const parsed = raw === undefined ? null : claimPayloadSchema.safeParse(raw);

    if (parsed === null || !parsed.success) {
      return {
        sequence: record.sequence,
        timestamp: record.timestamp,
        actor: record.actor,
        predicate: "",
        record: null,
        recordKind: "",
        narrative: "",
        evaluation: {
          verdict: "unverified",
          reason: "record-not-found",
          detail: `the claim payload ${record.payloadDigest} is missing or does not match the claim schema`,
        },
      };
    }

    const claim: ClaimPayload = parsed.data;
    return {
      sequence: record.sequence,
      timestamp: record.timestamp,
      actor: record.actor,
      predicate: claim.predicate,
      record: claim.record,
      recordKind: claim.recordKind,
      narrative: claim.narrative,
      evaluation: evaluateClaim(claim, lookup),
    };
  });

  const edges: EvidenceEdge[] = claims
    .filter((claim): claim is ClaimNode & { record: string } => claim.record !== null)
    .map((claim) => ({
      claimSequence: claim.sequence,
      record: claim.record,
      resolved: citable.has(claim.record),
    }));

  const verifiedCount = claims.filter((claim) => claim.evaluation.verdict === "verified").length;

  return {
    claims,
    evidence,
    edges,
    verifiedCount,
    unverifiedCount: claims.length - verifiedCount,
  };
}

function summarize(record: LedgerRecord, payload: JsonValue | null): string {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return record.type;
  }
  const fields = payload as { readonly [key: string]: JsonValue };

  switch (record.type) {
    case "tool-call":
      return `${stringField(fields, "decision")} ${stringField(fields, "toolName")}: ${stringField(fields, "detail")}`;
    case "model-call":
      return `step ${numberField(fields, "step")} of ${record.actor}, ${numberField(fields, "outputTokens")} output tokens`;
    case "confirmation":
      return `${stringField(fields, "outcome")} ${stringField(fields, "toolName")}: ${stringField(fields, "detail")}`;
    case "session-started":
      return `task: ${stringField(fields, "task")}`;
    case "session-stopped":
      return `${stringField(fields, "stopReason")} after ${numberField(fields, "steps")} steps`;
    case "gate-run":
      return `gate ${stringField(fields, "gateId")}: ${stringField(fields, "status")} (${stringField(fields, "detail")})`;
    case "ratchet-decision": {
      const verdict = fields.accepted === true ? "accepted" : "rejected";
      const compared =
        fields.scope === "base"
          ? "the final state against the base commit"
          : `attempt ${numberField(fields, "attempt")}`;
      return `${compared} ${verdict}: ${stringField(fields, "detail")}`;
    }
    case "file-set-declared":
      return `the planner declared ${numberField(fields, "fileCount")} intended file(s)`;
    case "file-set-amended":
      return `the file set was widened by ${numberField(fields, "addedCount")}: ${stringField(fields, "reason")}`;
    case "escalation":
      return `escalated at gate ${stringField(fields, "gateId")} after ${numberField(fields, "attemptsUsed")} attempt(s)`;
    // Below here: types that fell to the default and rendered as their own bare name. The
    // reward record holds what the run cost, and read "reward"; a reader had to expand a
    // payload to find a number the page could have told them.
    case "reward": {
      const cost = fields.costUsd;
      const priced = typeof cost === "number" && cost > 0 ? `$${cost.toFixed(4)}` : "nothing";
      return `scored ${numberField(fields, "reward")} after ${Math.round(numberField(fields, "latencyMs") / 1000)}s, costing ${priced}`;
    }
    case "routing-decision":
      return `routed to ${stringField(fields, "model")} by ${stringField(fields, "assignment")}: ${stringField(fields, "reason")}`;
    case "local-endpoint":
      return `local models served from ${stringField(fields, "url")}, ${stringField(fields, "reason")}`;
    case "workspace-diff": {
      const characters = numberField(fields, "characters");
      return characters === 0
        ? "the workspace was not changed"
        : `the change this task made, ${characters} characters of patch against ${stringField(fields, "baseRef")}`;
    }
    case "worker-started":
      return `worker ${stringField(fields, "workerId")} started on ${stringField(fields, "task")}`;
    case "worker-finished":
      return `worker ${stringField(fields, "workerId")} finished: ${stringField(fields, "outcome")}`;
    case "merge-attempt":
      return `merge of ${stringField(fields, "workerId")}: ${stringField(fields, "outcome")}`;
    default:
      return record.type;
  }
}

function stringField(fields: { readonly [key: string]: JsonValue }, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : "";
}

function numberField(fields: { readonly [key: string]: JsonValue }, key: string): number {
  const value = fields[key];
  return typeof value === "number" ? value : 0;
}
