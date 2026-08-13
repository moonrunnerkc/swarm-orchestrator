import { readBundle } from "./bundle.ts";
import type { BundleManifest } from "./bundle-manifest.ts";
import type { JsonValue } from "./canonical-json.ts";
import { buildEvidenceDag } from "./dag.ts";
import { verifyChain } from "./ledger.ts";
import type { LedgerRecord } from "./ledger-record.ts";
import { verifyChainHeadSignature } from "./signing.ts";

export interface ReplayInput {
  readonly records: readonly LedgerRecord[];
  readonly payloads: ReadonlyMap<string, JsonValue>;
  readonly manifest?: BundleManifest;
}

/**
 * Transcript replay, without qualification. The run is re-rendered from the records alone:
 * no network, no model rerun, and nothing written. Batched inference is nondeterministic
 * whatever the temperature, so re-running the model is never claimed to reproduce a run;
 * what replay verifies is that the recorded run is internally consistent, and it lets a
 * reviewer step through it.
 */
export function renderReplay(input: ReplayInput): readonly string[] {
  const chain = verifyChain(input.records);
  const dag = buildEvidenceDag(input.records, input.payloads);
  const lines: string[] = [];

  if (input.manifest !== undefined) {
    lines.push(
      `session ${input.manifest.sessionId}, exported ${isoTime(input.manifest.exportedAt)}`,
    );
    const signatureOk = verifyChainHeadSignature(
      input.manifest.chainHead,
      input.manifest.signature,
    );
    lines.push(
      `signature over the chain head: ${signatureOk ? "valid" : "INVALID"} ` +
        `(${input.manifest.signature.algorithm}, ${input.manifest.signature.keySource} key)`,
    );
    if (input.manifest.chainHead !== chain.head) {
      lines.push(
        `chain head MISMATCH: the manifest says ${input.manifest.chainHead}, the records hash to ${chain.head}`,
      );
    }
  }

  lines.push(
    chain.ok
      ? `hash chain intact across ${chain.recordCount} records, head ${chain.head}`
      : `hash chain BROKEN: ${chain.problems.map((problem) => problem.detail).join("; ")}`,
  );
  lines.push("");

  for (const record of input.records) {
    const payload = input.payloads.get(record.payloadDigest) ?? null;
    lines.push(
      `#${String(record.sequence).padStart(3, "0")} ${isoTime(record.timestamp)} ` +
        `${record.type.padEnd(15)} ${describePayload(record, payload)}`,
    );
  }

  lines.push("");
  for (const claim of dag.claims) {
    const verdict = claim.evaluation.verdict === "verified" ? "VERIFIED  " : "UNVERIFIED";
    const reason = claim.evaluation.reason === null ? "" : ` [${claim.evaluation.reason}]`;
    lines.push(`${verdict} #${claim.sequence} ${claim.predicate}${reason}`);
  }
  lines.push("");
  lines.push(
    `${dag.verifiedCount} of ${dag.claims.length} claims verified by the harness. ` +
      "Narrative text in this run is unverified prose and is not shown as a result.",
  );

  return lines;
}

/** Reads a bundle from disk and renders it. The read path never opens a socket or a writer. */
export async function replayBundle(directory: string): Promise<readonly string[]> {
  const bundle = await readBundle(directory);
  const lines = renderReplay({
    records: bundle.records,
    payloads: bundle.payloads,
    manifest: bundle.manifest,
  });
  if (bundle.problems.length === 0) {
    return lines;
  }
  return [
    ...lines,
    "",
    ...bundle.problems.map((problem) => `unreadable record: ${problem.detail}`),
  ];
}

function describePayload(record: LedgerRecord, payload: JsonValue | null): string {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return `${record.actor} (payload ${record.payloadDigest} absent from this bundle)`;
  }
  const fields = payload as { readonly [key: string]: JsonValue };

  switch (record.type) {
    case "session-started":
      return `task: ${text(fields.task)}`;
    case "model-call":
      return `step ${text(fields.step)} of ${record.actor}, ${text(fields.outputTokens)} output tokens, prompt ${short(record.promptDigest)} response ${short(record.responseDigest)}`;
    case "tool-call":
      return `${text(fields.decision)} ${text(fields.toolName)} ${firstLine(text(fields.detail))}`;
    case "confirmation":
      return `${text(fields.outcome)} ${text(fields.toolName)}: ${firstLine(text(fields.detail))}`;
    case "claim":
      return `predicate ${text(fields.predicate)} against ${text(fields.record)}`;
    case "session-stopped":
      return `${text(fields.stopReason)} after ${text(fields.steps)} steps, ${text(fields.tokensUsed)} tokens`;
    default:
      return record.actor;
  }
}

function text(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function short(digest: string | undefined): string {
  return digest === undefined ? "none" : `${digest.slice(0, 14)}...`;
}

function firstLine(value: string): string {
  const line = value.split("\n", 1)[0] ?? "";
  return line.length > 100 ? `${line.slice(0, 97)}...` : line;
}

function isoTime(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
