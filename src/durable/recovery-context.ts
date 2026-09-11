import { z } from "zod";
import type { ConversationMessage } from "../core/model-client.ts";
import { hashOfRecord } from "../evidence/ledger-record.ts";
import { parseRunSpec } from "../evidence/run-spec.ts";
import { reconstructTranscript } from "../evidence/transcript.ts";
import { gateSetSealSchema } from "../gates/gate-set-seal.ts";
import { readSessionEvidence } from "./session-evidence.ts";

const callSchema = z.object({ callId: z.string(), toolName: z.string(), input: z.unknown() });
const messageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), text: z.string() }),
  z.object({ role: z.literal("assistant"), text: z.string(), toolCalls: z.array(callSchema) }),
  z.object({
    role: z.literal("tool"),
    outcomes: z.array(
      z.object({
        callId: z.string(),
        toolName: z.string(),
        output: z.string(),
        failed: z.boolean(),
      }),
    ),
  }),
]);

export async function recoveryContext(sessionRoot: string, runId: string, now = Date.now()) {
  const parsed = await readSessionEvidence(sessionRoot, runId);
  const payloads = parsed.payloads;
  const seal = parsed.records.find((record) => record.type === "run-spec-sealed");
  const spec = parseRunSpec(payloads.get(seal?.payloadDigest ?? "")?.spec);
  const criteriaRecord = parsed.records.find((record) => record.type === "gate-set-sealed");
  const criteria = gateSetSealSchema.parse(payloads.get(criteriaRecord?.payloadDigest ?? ""));
  const calls = parsed.records.filter((record) => record.type === "model-call");
  const unfinished = parsed.records
    .filter((record) => record.type === "model-call-started")
    .some(
      (intent) =>
        !calls.some(
          (terminal) =>
            terminal.sequence > intent.sequence &&
            payloads.get(terminal.payloadDigest)?.startedRecord === intent.payloadDigest,
        ),
    );
  if (unfinished)
    throw new Error(
      "a provider call has no durable outcome; reconcile unknown usage before continuing under the sealed budget",
    );
  const last = calls.at(-1);
  const payload = payloads.get(last?.payloadDigest ?? "");
  const prompt =
    payload === undefined
      ? undefined
      : z
          .object({ messages: z.array(messageSchema) })
          .parse(reconstructTranscript(payload.prompt, payloads));
  const response =
    payload?.response === undefined || (payload.response as { failed?: unknown }).failed === true
      ? undefined
      : z.object({ text: z.string(), toolCalls: z.array(callSchema) }).parse(payload.response);
  const history: ConversationMessage[] = [...(prompt?.messages ?? [])] as ConversationMessage[];
  const pending: { callId: string; toolName: string; input: unknown }[] = [];
  if (response?.text !== undefined && response.toolCalls !== undefined) {
    history.push({ role: "assistant", text: response.text, toolCalls: response.toolCalls });
    const outcomes = response.toolCalls.map((call) => {
      const terminal = parsed.records
        .filter((record) => record.type === "tool-call" && record.sequence > (last?.sequence ?? -1))
        .map((record) => payloads.get(record.payloadDigest))
        .find((entry) => entry?.callId === call.callId && entry?.decision !== "requested");
      if (terminal === undefined || terminal.decision === "failed") pending.push(call);
      return {
        callId: call.callId,
        toolName: call.toolName,
        failed: terminal?.decision !== "allowed",
        output:
          typeof terminal?.output === "string"
            ? terminal.output
            : "no durable completion was recorded",
      };
    });
    if (outcomes.length > 0) history.push({ role: "tool", outcomes });
  }
  if (calls.some((record) => payloads.get(record.payloadDigest)?.usageStatus === "unknown"))
    throw new Error(
      "provider usage is unknown in this run; a continuation cannot reconstruct the remaining sealed token budget",
    );
  const tokensUsed = calls.reduce((sum, record) => {
    const call = payloads.get(record.payloadDigest);
    return sum + Number(call?.inputTokens ?? 0) + Number(call?.outputTokens ?? 0);
  }, 0);
  const ambiguous = pending.filter((call) => !["read", "list", "search"].includes(call.toolName));
  if (ambiguous.length > 0)
    throw new Error(
      `recovery requires reconciliation of ambiguous effects: ${ambiguous.map((call) => `${call.toolName}:${call.callId}`).join(", ")}. No external effect was replayed`,
    );
  const started = parsed.records[0]?.timestamp;
  const lastTimestamp = parsed.records.at(-1)?.timestamp;
  const elapsed =
    started === undefined || lastTimestamp === undefined
      ? spec.budgets.maxWallMs
      : Math.max(0, lastTimestamp - started, now - started);
  const remainingWallMs = Math.max(0, spec.budgets.maxWallMs - elapsed);
  const remainingSteps = Math.max(0, spec.budgets.maxSteps - calls.length);
  if (remainingWallMs <= 0 || remainingSteps <= 0 || tokensUsed >= spec.budgets.maxTokens)
    throw new Error("the sealed run has no execution budget left; start a new run explicitly");
  return {
    spec,
    criteria,
    source: {
      sessionId: runId,
      head: hashOfRecord(parsed.records.at(-1) as (typeof parsed.records)[number]),
    },
    remainingWallMs,
    deadline: now + remainingWallMs,
    remainingAttempts: Math.max(
      0,
      spec.budgets.attempts -
        parsed.records.filter(
          (entry) =>
            entry.type === "ratchet-decision" &&
            payloads.get(entry.payloadDigest)?.scope === "retry",
        ).length,
    ),
    remainingSteps,
    history,
    remainingTokens: Math.max(0, spec.budgets.maxTokens - tokensUsed),
    pending,
  };
}
