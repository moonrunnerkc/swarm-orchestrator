import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { campaignOutcomeSchema, openCampaign } from "../../src/eval/campaign-record.ts";
import { goalCampaignProtocolSchema } from "../../src/eval/goal-protocol.ts";
import { asJsonValue, digestOfBytes, digestOfJson } from "../../src/evidence/canonical-json.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { verifyBundle } from "../../src/evidence/verifier/verify.mjs";
import { summarizeCrossover } from "./pilot-crossover.mjs";
import { assertFrozenInputs } from "./pilot-run.mjs";

const count = z.number().int().nonnegative();
const milliseconds = z.number().nonnegative();
const reconciliationSchema = z.object({
  executionId: z.string(),
  executionWallMs: milliseconds.nullable(),
  reason: z.string(),
});
const clock = { now: Date.now, sleep: async () => {} };
const sumKnown = (values) =>
  values.length === 0 || values.some((value) => value === null)
    ? null
    : values.reduce((total, value) => total + value, 0);

export function inspectArmEvidence(role, sessions, limits) {
  const configurations = [];
  const resourceDeclarations = [];
  const peerTools = new Set();
  let workerPrompts = 0;
  let revisions = 0;
  for (const { sessionId, entries } of sessions) {
    const payloads = new Map(entries.map(({ record, payload }) => [record.payloadDigest, payload]));
    for (const { record, payload } of entries) {
      if (record.type === "controller-configuration") {
        const { spec } = z
          .object({
            spec: z.object({
              adaptation: z.boolean(),
              peerInformation: z.boolean(),
              concurrency: count.positive(),
            }),
          })
          .parse(payload);
        assert.equal(
          spec.adaptation,
          role !== "no-adaptation",
          "adaptation ablation did not reach the controller",
        );
        assert.equal(
          spec.peerInformation,
          !["single", "no-peer"].includes(role),
          "peer ablation did not reach the controller",
        );
        assert.equal(spec.concurrency, role === "single" ? 1 : limits.worktreeConcurrency);
        configurations.push({ record: record.payloadDigest, ...spec });
      }
      if (record.type === "controller-event" && payload.kind === "run-started") {
        const resource = z
          .object({ modelConcurrency: count.positive(), testConcurrency: count.positive() })
          .parse(payload);
        assert.equal(resource.modelConcurrency, limits.modelConcurrency);
        assert.equal(resource.testConcurrency, limits.testConcurrency);
        resourceDeclarations.push({ record: record.payloadDigest, ...resource });
      }
      if (record.type === "controller-graph" && payload.parent !== null) revisions++;
      if (!sessionId.startsWith("worker-") || record.type !== "model-call-started") continue;
      const prompt = z
        .object({ transcriptVersion: count.optional(), tools: z.unknown() })
        .parse(payload.prompt);
      const tools =
        prompt.transcriptVersion === 2
          ? z
              .object({ kind: z.literal("tools"), value: z.unknown() })
              .parse(payloads.get(prompt.tools)).value
          : prompt.tools;
      const names = z
        .array(z.object({ name: z.string() }))
        .parse(tools)
        .map((tool) => tool.name);
      workerPrompts++;
      for (const name of names)
        if (["read_trail", "coordinate", "read_coordination"].includes(name)) peerTools.add(name);
    }
  }
  if (["single", "no-peer"].includes(role))
    assert.equal(peerTools.size, 0, "peer tools reached a disabled worker");
  if (role === "no-adaptation")
    assert.equal(revisions, 0, "a graph revision occurred with adaptation disabled");
  return {
    configurations,
    resourceDeclarations,
    workerPrompts,
    peerTools: [...peerTools].sort(),
    graphRevisions: revisions,
    configurationObserved: configurations.length > 0,
    limitation:
      role === "frozen-parallel"
        ? "The historical controller has no current configuration record; its source and frozen wrapper identify this arm."
        : null,
  };
}

export function assertObservation(outcome, observation, manifest, healthy = true) {
  const parsed = z.object({ outcome: z.unknown(), integrity: count.nullable() }).parse(observation);
  const worker = campaignOutcomeSchema.parse({
    executionId: outcome.executionId,
    ...parsed.outcome,
  });
  const settled = campaignOutcomeSchema.parse(outcome);
  // The frozen campaign includes both health probes and replaces status after failed health.
  assert(settled.latencyMs >= worker.latencyMs, "campaign elapsed time omits executor time");
  assert.deepEqual(
    {
      ...worker,
      latencyMs: settled.latencyMs,
      ...(!healthy ? { status: "infrastructure-failure", cleanup: "failed" } : {}),
    },
    settled,
    "raw observation disagrees with the settled campaign outcome",
  );
  if (outcome.evidenceDigest !== null) {
    assert(manifest !== null, "settled evidence manifest is missing");
    assert.equal(digestOfBytes(manifest), outcome.evidenceDigest, "evidence manifest changed");
  }
  return parsed.integrity;
}

/** Calendar time to crash reconciliation is not execution time. Keep the original row too. */
export function summarizeSlots(protocol, schedule, outcomes, reconciliations = []) {
  const amendments = new Map();
  for (const input of reconciliations) {
    const amendment = reconciliationSchema.parse(input);
    if (amendments.has(amendment.executionId))
      throw new Error("duplicate execution-time reconciliation");
    if (!schedule.some((entry) => entry.executionId === amendment.executionId))
      throw new Error("execution-time reconciliation is outside the frozen schedule");
    amendments.set(amendment.executionId, amendment);
  }
  const slots = schedule.map((entry) => {
    const outcome = outcomes.get(entry.executionId) ?? null;
    const amendment = amendments.get(entry.executionId);
    return {
      ...entry,
      outcome,
      executionWallMs:
        amendment === undefined ? (outcome?.latencyMs ?? null) : amendment.executionWallMs,
      timeQualification: amendment?.reason ?? null,
      complete: outcome?.certified === true && outcome.heldBackAccepted === true,
      judgmentUnknown:
        outcome === null || outcome.certified === null || outcome.heldBackAccepted === null,
      budgetExhausted:
        outcome?.goal?.termination === "budget" ||
        /(?:token|wall) budget|budget.*(?:exhaust|reserve)/i.test(outcome?.goal?.detail ?? ""),
    };
  });
  return {
    slots,
    arms: protocol.arms.map((arm) => {
      const rows = slots.filter((slot) => slot.armId === arm.id);
      const observed = rows.filter((slot) => slot.outcome !== null);
      return {
        id: arm.id,
        scheduled: rows.length,
        settled: observed.length,
        complete: rows.filter((slot) => slot.complete).length,
        observedIncorrectAcceptance: rows.filter(
          (slot) => slot.outcome?.certified === true && slot.outcome.heldBackAccepted === false,
        ).length,
        unknownJudgments: rows.filter((slot) => slot.judgmentUnknown).length,
        executionWallMs: sumKnown(rows.map((slot) => slot.executionWallMs)),
        knownExecutionWallMs: observed.reduce(
          (total, slot) => total + (slot.executionWallMs ?? 0),
          0,
        ),
        unknownExecutionTimes: rows.filter((slot) => slot.executionWallMs === null).length,
        inputTokens: sumKnown(rows.map((slot) => slot.outcome?.goal?.inputTokens ?? null)),
        outputTokens: sumKnown(rows.map((slot) => slot.outcome?.goal?.outputTokens ?? null)),
        unknownCalls: sumKnown(rows.map((slot) => slot.outcome?.goal?.unknownCalls ?? null)),
        reservedTokens: sumKnown(rows.map((slot) => slot.outcome?.goal?.reservedTokens ?? null)),
        retries: sumKnown(rows.map((slot) => slot.outcome?.goal?.retries ?? null)),
        integrationFailures: sumKnown(
          rows.map((slot) => slot.outcome?.goal?.integrationFailures ?? null),
        ),
        integrationRepairs: sumKnown(
          rows.map((slot) => slot.outcome?.goal?.integrationRepairs ?? null),
        ),
        budgetExhaustions: rows.filter((slot) => slot.budgetExhausted).length,
        infrastructureFailures: rows.filter(
          (slot) => slot.outcome?.status === "infrastructure-failure",
        ).length,
        recordedHumanInterventions: sumKnown(
          rows.map((slot) => slot.outcome?.goal?.humanInterventions ?? null),
        ),
        recordedHumanRepairMinutes: sumKnown(
          rows.map((slot) => slot.outcome?.goal?.humanRepairMinutes ?? null),
        ),
        providerReportedCostUsd: sumKnown(rows.map((slot) => slot.outcome?.costUsd ?? null)),
      };
    }),
  };
}

function intervalSummary(intervals) {
  const changes = intervals.flatMap(([start, end]) => [
    { at: start, delta: 1 },
    { at: end, delta: -1 },
  ]);
  changes.sort((left, right) => left.at - right.at || left.delta - right.delta);
  let occupied = 0;
  let maximum = 0;
  let unionMs = 0;
  let previous = changes[0]?.at ?? 0;
  for (const change of changes) {
    if (occupied > 0) unionMs += change.at - previous;
    occupied += change.delta;
    maximum = Math.max(maximum, occupied);
    previous = change.at;
  }
  return { intervals: intervals.length, maximum, unionMs };
}

/** Durations exclude permit waiting; overlap is descriptive, not a scheduler benchmark. */
export function summarizeResources(sessions) {
  const models = [];
  const commands = [];
  const firstTokenMs = [];
  let reportedInputTokens = 0;
  let reportedOutputTokens = 0;
  let unknownModelCalls = 0;
  let observedRateLimitResponses = 0;
  for (const entries of sessions) {
    for (const { record, payload } of entries) {
      if (record.type === "model-call") {
        const call = z
          .object({
            usageStatus: z.enum(["reported", "unknown"]).optional(),
            inputTokens: count,
            outputTokens: count,
            performance: z
              .object({ responseTimeMs: milliseconds, firstTokenMs: milliseconds.nullable() })
              .optional(),
            providerAttempts: z.array(z.object({ statusCode: z.number().nullable() })).optional(),
          })
          .parse(payload);
        if (call.usageStatus === "reported") {
          reportedInputTokens += call.inputTokens;
          reportedOutputTokens += call.outputTokens;
        } else unknownModelCalls++;
        observedRateLimitResponses += (call.providerAttempts ?? []).filter(
          (attempt) => attempt.statusCode === 429,
        ).length;
        if (call.performance?.firstTokenMs !== null && call.performance?.firstTokenMs !== undefined)
          firstTokenMs.push(call.performance.firstTokenMs);
        if (call.performance?.responseTimeMs > 0)
          models.push([record.timestamp - call.performance.responseTimeMs, record.timestamp]);
      }
      if (record.type === "gate-run") {
        const gate = z
          .object({ durationMs: milliseconds, command: z.string().nullable() })
          .parse(payload);
        if (gate.command !== null && gate.durationMs > 0)
          commands.push([record.timestamp - gate.durationMs, record.timestamp]);
      }
    }
  }
  return {
    reportedInputTokens,
    reportedOutputTokens,
    unknownModelCalls,
    observedRateLimitResponses,
    modelCalls: intervalSummary(models),
    commandGates: intervalSummary(commands),
    firstTokenMs,
    otherProviderTokenCategories: null,
    limitation:
      "Intervals end at the evidence timestamp and can include recording delay. Gate intervals omit setup, tools and unnamed subprocesses. Permit wait, CPU pressure and pure controller overhead are not determined by these records. Cache and reasoning token categories were not retained by this frozen adapter; do not add estimates to the reported input/output totals.",
  };
}

export async function reportPilot(root) {
  const frozen = JSON.parse(await readFile(join(root, "frozen.json"), "utf8"));
  z.object({ sourceCommit: z.string().regex(/^[a-f0-9]{40}$/) }).parse(frozen);
  const protocol = goalCampaignProtocolSchema.parse(frozen.protocol);
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "pilot",
    clock,
  });
  assertFrozenInputs(evidence, frozen);
  const campaign = await openCampaign(protocol, evidence, { resume: true });
  const original = campaign.report();
  const outcomes = new Map();
  const reconciliations = [];
  const reconciliationDigests = new Map();
  const healthAfter = new Map();
  for (const record of evidence.records()) {
    const payload = evidence.payloads().get(record.payloadDigest);
    if (record.type !== "campaign-observation") continue;
    if (payload.phase === "settled") outcomes.set(payload.executionId, payload);
    if (payload.phase === "health-after")
      healthAfter.set(payload.executionId, payload.healthy === true);
    if (payload.phase === "execution-reconciled") {
      assert.equal(record.actor, "harness");
      reconciliations.push(payload);
      reconciliationDigests.set(payload.executionId, record.payloadDigest);
    }
  }
  const summary = summarizeSlots(protocol, campaign.schedule, outcomes, reconciliations);
  const resources = [];
  const inventory = [];
  for (const slot of summary.slots.filter((slot) => slot.outcome !== null)) {
    const relative = join("launches", slot.executionId.replace(/^sha256:/, ""));
    const directory = join(root, relative);
    let bundleVerification = null;
    if (reconciliationDigests.has(slot.executionId)) {
      assert.equal(slot.outcome.evidenceDigest, reconciliationDigests.get(slot.executionId));
    } else {
      const raw = await readFile(join(directory, "observation.json"));
      const manifest =
        slot.outcome.evidenceDigest === null
          ? null
          : await readFile(join(directory, "bundle", "manifest.json"));
      assert(healthAfter.has(slot.executionId), "settled launch lacks its health observation");
      const expected = assertObservation(
        slot.outcome,
        JSON.parse(raw.toString()),
        manifest,
        healthAfter.get(slot.executionId),
      );
      if (expected !== null) {
        bundleVerification = verifyBundle(join(directory, "bundle"), () => {});
        assert.equal(bundleVerification, expected, "independent bundle verdict changed");
      }
      inventory.push({ path: join(relative, "observation.json"), digest: digestOfBytes(raw) });
    }
    const sessions = [];
    const armSessions = [];
    for (const sessionId of (await readdir(join(root, relative, "sessions"))).sort()) {
      const session = await openEvidenceSession({
        root: join(root, relative, "sessions"),
        sessionId,
        clock,
      });
      const entries = session
        .records()
        .map((record) => ({ record, payload: session.payloads().get(record.payloadDigest) }));
      sessions.push(entries);
      armSessions.push({ sessionId, entries });
      inventory.push({
        path: join(relative, "sessions", sessionId, "ledger.jsonl"),
        head: session.head(),
        digest: digestOfBytes(await readFile(session.ledgerPath)),
      });
    }
    resources.push({
      executionId: slot.executionId,
      bundleVerification,
      armEvidence: inspectArmEvidence(
        protocol.arms.find((arm) => arm.id === slot.armId).role,
        armSessions,
        protocol.limits,
      ),
      ...summarizeResources(sessions),
    });
  }
  assert.deepEqual(
    (await openEvidenceSession({ root: join(root, "sessions"), sessionId: "pilot", clock })).head(),
    evidence.head(),
    "campaign changed while reporting; retry after the active slot settles",
  );
  return {
    version: 1,
    evaluatedSource: frozen.sourceCommit,
    protocolDigest: original.protocolDigest,
    frozenManifestDigest: digestOfJson(asJsonValue(frozen)),
    campaignHead: evidence.head(),
    originalReport: original,
    ...summary,
    resources,
    inventory,
    crossover: summarizeCrossover(frozen.candidates, summary.slots, protocol.arms),
    completeSchedule: original.goal.allObserved && campaign.unresolved().length === 0,
    limitations: [
      "All scheduled slots remain in the declared analysis. Infrastructure errors are not measurements of agent performance.",
      "The original elapsed aggregate includes calendar time to administrative reconciliation; use the qualified execution time in this report.",
      "Recorded human counters cover the runner, not unlogged preparation or operator effort. Unknown human time is not zero.",
      "Provider invoices and cache/reasoning categories are unavailable. Local weights avoid a metered model service; electricity and hardware cost are not measured.",
      "The declared repository bootstrap intervals are descriptive. Five arms and retries on a goal are correlated; the pilot is not an external competitor comparison.",
    ],
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [root, destination] = process.argv.slice(2);
  if (!root || !destination)
    throw new Error("Supply the frozen campaign directory and a new report directory");
  const report = await reportPilot(resolve(root));
  await mkdir(resolve(destination), { mode: 0o700 });
  const path = join(resolve(destination), "report.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        path,
        digest: digestOfBytes(await readFile(path)),
        completeSchedule: report.completeSchedule,
        arms: report.arms.map(({ id, scheduled, settled, complete, unknownJudgments }) => ({
          id,
          scheduled,
          settled,
          complete,
          unknownJudgments,
        })),
      },
      null,
      2,
    ),
  );
}
