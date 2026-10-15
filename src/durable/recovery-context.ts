import { z } from "zod";
import { escalationEventSchema } from "../agent-escalation.ts";
import type { ConversationMessage } from "../core/model-client.ts";
import type { JsonValue } from "../evidence/canonical-json.ts";
import { freezeGoalContract, isRootDeclaration } from "../evidence/goal-contract.ts";
import { hashOfRecord } from "../evidence/ledger-record.ts";
import { parseRunSpec } from "../evidence/run-spec.ts";
import { reconstructTranscript } from "../evidence/transcript.ts";
import { replayFileSet } from "../gates/file-set.ts";
import { gateSetSealSchema } from "../gates/gate-set-seal.ts";
import { assertGoalEffectsSettled } from "../gates/goal-effects.ts";
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
  assertGoalEffectsSettled(parsed.records, payloads);
  const seal = parsed.records.find((record) => record.type === "run-spec-sealed");
  const spec = parseRunSpec(payloads.get(seal?.payloadDigest ?? "")?.spec);
  // Probes and revisions name their parent and never replace the run's own declaration.
  const goals = parsed.records.filter(
    (record) =>
      record.type === "goal-contract" && isRootDeclaration(payloads.get(record.payloadDigest)),
  );
  if (goals.length > 1) throw new Error("goal contract changed; reconcile before resuming");
  let goalDeadline: number | undefined;
  let goal:
    | {
        contract: ReturnType<typeof freezeGoalContract>["contract"];
        install: boolean;
        lockfile?: string;
      }
    | undefined;
  if (goals[0] !== undefined) {
    const frozen = freezeGoalContract(payloads.get(goals[0].payloadDigest)?.contract);
    const settings = parsed.records.filter(
      (record) =>
        record.type === "verification-command" &&
        payloads.get(record.payloadDigest)?.rule === "goal-run-settings-v1",
    );
    if (settings.length !== 1)
      throw new Error("sealed goal settings are missing or changed; reconcile before resuming");
    const value = z
      .object({
        contractDigest: z.string(),
        install: z.boolean(),
        lockfile: z.string().optional(),
        sourceBase: z.string(),
        deadline: z.number(),
      })
      .parse(payloads.get(settings[0]?.payloadDigest ?? ""));
    if (value.contractDigest !== frozen.digest || value.sourceBase !== spec.repository.baseCommit)
      throw new Error("goal contract or source changed; reconcile before resuming");
    if (value.deadline <= now) throw new Error("the original goal deadline has elapsed");
    goalDeadline = value.deadline;
    goal = {
      contract: frozen.contract,
      install: value.install,
      ...(value.lockfile === undefined ? {} : { lockfile: value.lockfile }),
    };
  }
  const staging = new Set<string>();
  for (const record of parsed.records) {
    const value = payloads.get(record.payloadDigest);
    if (record.type !== "verification-command" || value?.rule !== "prepared-python-v1") continue;
    const effect = z
      .object({
        phase: z.enum(["intent", "completed"]),
        unit: z.string(),
        environmentDigest: z.string(),
      })
      .parse(value);
    const id = `${effect.unit}:${effect.environmentDigest}`;
    if (effect.phase === "intent") staging.add(id);
    else if (!staging.delete(id))
      throw new Error("environment staging completion has no intent; reconcile before resuming");
  }
  if (staging.size)
    throw new Error(
      "environment staging is interrupted; reconcile its owned checkout before resuming",
    );
  const criteriaRecord = parsed.records.find((record) => record.type === "gate-set-sealed");
  const criteria = gateSetSealSchema.parse(payloads.get(criteriaRecord?.payloadDigest ?? ""));
  let escalationCount = spec.escalationsUsed ?? 0;
  let pendingEscalation = false;
  for (const entry of parsed.records.filter((record) => record.type === "session-budget")) {
    const payload = payloads.get(entry.payloadDigest);
    if (payload?.rule !== "capability-escalation-v1") continue;
    const event = escalationEventSchema.parse(payload);
    if (event.requestedModel !== spec.escalation?.target)
      throw new Error("escalation contract changed; reconcile before resuming");
    if (event.phase === "intent") {
      if (escalationCount !== 0) throw new Error("duplicate escalation; reconcile before resuming");
      escalationCount = 1;
      pendingEscalation = true;
    } else {
      if (!pendingEscalation || event.unknownUsage)
        throw new Error("ambiguous escalation usage; reconcile before resuming");
      pendingEscalation = false;
    }
  }
  if (pendingEscalation)
    throw new Error(
      "escalation has no completed effect; reconcile billing and source before resuming",
    );
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
  // A call the harness itself cancelled (an interruption, the wall) reported no usage, and its
  // cost is bounded by what it was asked for: it is charged at the bound its record carries,
  // and the charge is named on the continuation. A call whose usage is unknown for any other
  // reason has no bound on the record and still refuses the continuation.
  const chargedForCancelledCalls = { calls: 0, tokens: 0 };
  for (const record of calls) {
    const call = payloads.get(record.payloadDigest);
    if (call?.usageStatus !== "unknown") continue;
    const bound = requestBoundSchema.safeParse(call.requestBound);
    if (call.cancelled !== true || !bound.success)
      throw new Error(
        "provider usage is unknown in this run; a continuation cannot reconstruct the remaining sealed token budget",
      );
    chargedForCancelledCalls.calls += 1;
    chargedForCancelledCalls.tokens += bound.data.reservedTokens;
  }
  const tokensUsed =
    calls.reduce((sum, record) => {
      const call = payloads.get(record.payloadDigest);
      return sum + Number(call?.inputTokens ?? 0) + Number(call?.outputTokens ?? 0);
    }, 0) + chargedForCancelledCalls.tokens;
  const ambiguous = pending.filter((call) => !["read", "list", "search"].includes(call.toolName));
  if (ambiguous.length > 0)
    throw new Error(
      `recovery requires reconciliation of ambiguous effects: ${ambiguous.map((call) => `${call.toolName}:${call.callId}`).join(", ")}. No external effect was replayed`,
    );
  const started = parsed.records[0]?.timestamp;
  const lastTimestamp = parsed.records.at(-1)?.timestamp;
  const childHomeOwner = childHomeOwnerOf(parsed.records, payloads, runId);
  // The endpoint the run was pinned to, so a continuation reaches the same server rather than
  // whichever one discovery finds first; a run that let discovery choose records no pin.
  const endpointRecord = parsed.records.find((record) => record.type === "local-endpoint");
  const endpoint = localEndpointSchema.safeParse(payloads.get(endpointRecord?.payloadDigest ?? ""));
  const localEndpoint =
    endpoint.success && endpoint.data.origin === "flag" ? endpoint.data.url : null;
  // The files the run was authorized to edit, declared and amended on its chain. A continuation
  // opens a new chain, and a write there before a declaration is a write before authorization,
  // so the continuation re-declares this set first, naming the session it came from.
  const fileSet = replayFileSet({
    records: () => parsed.records,
    // Parsed JSON blobs are JSON values; the reader types them as records for field access.
    payloads: () => payloads as ReadonlyMap<string, JsonValue>,
  });
  const declaredFiles = fileSet.wasDeclared ? [...fileSet.allowed] : [];
  const elapsed =
    started === undefined || lastTimestamp === undefined
      ? spec.budgets.maxWallMs
      : Math.max(0, lastTimestamp - started, now - started);
  const remainingWallMs = Math.max(
    0,
    Math.min(
      spec.budgets.maxWallMs - elapsed,
      goalDeadline === undefined ? Number.POSITIVE_INFINITY : goalDeadline - now,
    ),
  );
  const remainingSteps = Math.max(0, spec.budgets.maxSteps - calls.length);
  if (remainingWallMs <= 0 || remainingSteps <= 0 || tokensUsed >= spec.budgets.maxTokens)
    throw new Error("the sealed run has no execution budget left; start a new run explicitly");
  return {
    ...(goal === undefined ? {} : { goal }),
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
    escalationCount,
    remainingTokens: Math.max(0, spec.budgets.maxTokens - tokensUsed),
    pending,
    childHomeOwner,
    chargedForCancelledCalls,
    localEndpoint,
    declaredFiles,
  };
}

const localEndpointSchema = z.object({ origin: z.string(), url: z.string().url() });

const requestBoundSchema = z.object({
  reservedTokens: z.number().int().nonnegative(),
  maxOutputTokens: z.number().int().nonnegative(),
});

const childHomeStateSchema = z.object({
  mode: z.enum(["private", "explicit"]),
  runId: z.string().min(1),
});

/**
 * The run whose private child HOME a continuation takes back. A session that was itself a
 * continuation recorded the original run's id in its execution envelope, and that is the home
 * that holds the state; resuming under the intermediate session's own id would allocate a
 * fresh home beside it and read the original's absence as "recreated". A session with no
 * envelope, or one that ran under a caller-named home, has nothing of its own to hand on, so
 * its own id stands.
 */
export function childHomeOwnerOf(
  records: readonly { readonly type: string; readonly payloadDigest: string }[],
  payloads: ReadonlyMap<string, Record<string, unknown>>,
  runId: string,
): string {
  const envelope = records.find((record) => record.type === "execution-envelope");
  const state = childHomeStateSchema.safeParse(
    payloads.get(envelope?.payloadDigest ?? "")?.childHomeState,
  );
  return state.success && state.data.mode === "private" ? state.data.runId : runId;
}
