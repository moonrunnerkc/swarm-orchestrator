import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, loadavg, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createSystemClock } from "../../src/cli-runtime-inputs.ts";
import { asJsonValue, digestOfJson } from "../../src/evidence/canonical-json.ts";
import { createRecordingModelClient } from "../../src/evidence/model-call-recording.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { createResourcePool } from "../../src/exec/resource-pool.ts";
import { runProcessGroup } from "../../src/exec/run-process.ts";
import { installFromLockfile } from "../../src/gates/dependency-install.ts";
import { createProviderRegistry } from "../../src/providers/registry.ts";
import { createRunContext } from "../../src/workers/run-context.ts";
import { reportPilot } from "./pilot-report.mjs";
import { assertLocalModel, preparedCaseSchema } from "./pilot-run.mjs";
import { checkoutBase, projectGateOptions, runtimeFor } from "./pilot-runtime.mjs";

const source = resolve(new URL("../..", import.meta.url).pathname);
const clock = createSystemClock();
const system =
  "Read this repository engineering goal and list its concrete obligations briefly. Do not propose code or execute tools.";
const limits = { tokens: 600_000, wallMs: 900_000, cleanupMs: 60_000, modelCalls: 24 };
const order = [1, 2, 2, 1];
const profileProtocolSchema = z
  .object({
    version: z.literal(1),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    campaignRoot: z.string().min(1),
    campaignHead: z.object({ hash: z.string(), sequence: z.number(), recordCount: z.number() }),
    frozenManifestDigest: z.string(),
    model: z.object({ name: z.string(), digest: z.string() }),
    endpoint: z.string().url(),
    selectedCases: z.array(z.string()).length(2),
    system: z.literal(system),
    maxOutputTokens: z.literal(128),
    limits: z.object({
      tokens: z.literal(600_000),
      wallMs: z.literal(900_000),
      cleanupMs: z.literal(60_000),
      modelCalls: z.literal(24),
    }),
    schedule: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["model", "tests", "worktree", "mixed"]),
        concurrency: z.union([z.literal(1), z.literal(2)]),
        operations: z.number().int().positive(),
      }),
    ),
  })
  .passthrough();
const git = (...args) =>
  execFileSync("git", args, {
    cwd: source,
    env: harnessChildEnvironment().variables,
    encoding: "utf8",
  }).trim();

/** Fixed batches are measurements, with no outcome-dependent retries or additional calls. */
export function profileSchedule() {
  return [
    ...order.map((concurrency, index) => ({
      id: `model-${index}`,
      kind: "model",
      concurrency,
      operations: 4,
    })),
    ...order.map((concurrency, index) => ({
      id: `tests-${index}`,
      kind: "tests",
      concurrency,
      operations: 2,
    })),
    ...order.map((concurrency, index) => ({
      id: `worktree-${index}`,
      kind: "worktree",
      concurrency,
      operations: 2,
    })),
    ...order.map((concurrency, index) => ({
      id: `mixed-${index}`,
      kind: "mixed",
      concurrency,
      operations: 3,
    })),
  ];
}

export function profileProgress(events) {
  const completed = new Map();
  for (const event of events.filter((row) => row.phase === "batch-completed")) {
    assert(!completed.has(event.result.id), "duplicate profiling batch outcome");
    completed.set(event.result.id, event.result);
  }
  const pending = events.filter(
    (row) => row.phase === "batch-intent" && !completed.has(row.batch.id),
  );
  assert.equal(
    pending.length,
    0,
    "interrupted batch requires effect and usage reconciliation; do not replay it",
  );
  return completed;
}

export function requireRuntimeCleanup(evidence) {
  const live = new Set();
  for (const row of evidence.records()) {
    const event = evidence.payloads().get(row.payloadDigest);
    if (row.type !== "campaign-observation" || event?.kind !== "runtime-resource") continue;
    if (["create-intent", "created"].includes(event.phase)) live.add(event.identity);
    if (event.phase === "removed") live.delete(event.identity);
  }
  assert.equal(live.size, 0, `runtime cleanup requires reconciliation: ${[...live].join(", ")}`);
}

export async function measureBatch({ batch, tasks, record, signal }) {
  const shared = createResourcePool(batch.concurrency === 1 ? 1 : 2);
  const separate = { model: createResourcePool(1), tests: createResourcePool(1) };
  const started = performance.now();
  const cpu = process.cpuUsage();
  const loadBefore = loadavg();
  const rows = await Promise.allSettled(
    tasks.map(async (task, index) => {
      const queued = performance.now();
      const pool = batch.kind === "mixed" && batch.concurrency === 2 ? separate[task.kind] : shared;
      return pool.run(async () => {
        const admitted = performance.now();
        await record({ phase: "operation-intent", batch: batch.id, index, kind: task.kind });
        let observation;
        try {
          observation = { status: "completed", value: await task.run() };
        } catch (cause) {
          observation = {
            status: "failed",
            detail: cause instanceof Error ? cause.message : String(cause),
          };
        }
        const row = {
          index,
          kind: task.kind,
          queuedAtMs: queued - started,
          startedAtMs: admitted - started,
          queueMs: admitted - queued,
          elapsedMs: performance.now() - admitted,
          ...observation,
        };
        await record({ phase: "operation-completed", batch: batch.id, ...row });
        return row;
      }, signal);
    }),
  );
  const rejected = rows.find((row) => row.status === "rejected");
  if (rejected) throw rejected.reason;
  return {
    ...batch,
    durationMs: performance.now() - started,
    parentCpuMicros: process.cpuUsage(cpu),
    loadBefore,
    loadAfter: loadavg(),
    rows: rows.map((row) => row.value),
  };
}

async function inventory() {
  const response = await fetch("http://127.0.0.1:11434/api/tags", {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Local model inventory returned ${response.status}`);
  return z
    .object({
      models: z.array(
        z.object({
          name: z.string(),
          digest: z.string(),
          remote_host: z.string().optional(),
          remote_model: z.string().optional(),
        }),
      ),
    })
    .parse(await response.json());
}

export async function freezeProfile(campaignRoot, destination) {
  assert.equal(git("status", "--porcelain"), "", "freeze profiling from a clean source checkout");
  const campaign = await reportPilot(campaignRoot);
  assert(campaign.completeSchedule, "complete the pilot before freezing live contention work");
  const frozen = JSON.parse(await readFile(join(campaignRoot, "frozen.json"), "utf8"));
  const candidates = [
    frozen.candidates.find((item) => item.language !== "python"),
    frozen.candidates.find((item) => item.language === "python"),
  ].map((item) => preparedCaseSchema.parse(item));
  const model = assertLocalModel(await inventory(), frozen.settings.model, frozen.model.digest);
  const protocol = {
    version: 1,
    sourceCommit: git("rev-parse", "HEAD"),
    campaignRoot,
    campaignHead: campaign.campaignHead,
    frozenManifestDigest: campaign.frozenManifestDigest,
    model: { name: model.name, digest: model.digest },
    endpoint: frozen.settings.endpoint,
    selectedCases: candidates.map((item) => item.id),
    selection: "First non-Python and first Python case in frozen order, independent of acceptance.",
    system,
    maxOutputTokens: 128,
    limits,
    schedule: profileSchedule(),
    environment: { node: process.version, platform: platform(), arch: arch(), release: release() },
    analysis:
      "Counterbalanced descriptive measurements on two natural repository workloads. No population inference, model ranking, worker selection threshold or pilot denominator changes.",
  };
  await mkdir(destination, { mode: 0o700 });
  await writeFile(join(destination, "protocol.json"), `${JSON.stringify(protocol, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  const evidence = await openEvidenceSession({
    root: join(destination, "sessions"),
    sessionId: "profile",
    clock,
  });
  await evidence.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["user", "file"],
    payload: asJsonValue({
      phase: "profile-frozen",
      protocol,
      digest: digestOfJson(asJsonValue(protocol)),
    }),
  });
  return protocol;
}

export async function runProfile(destination) {
  const protocol = profileProtocolSchema.parse(
    JSON.parse(await readFile(join(destination, "protocol.json"), "utf8")),
  );
  assert.equal(protocol.sourceCommit, git("rev-parse", "HEAD"));
  assert.equal(git("status", "--porcelain"), "");
  assert.deepEqual(protocol.limits, limits);
  assert.deepEqual(protocol.schedule, profileSchedule());
  const evidence = await openEvidenceSession({
    root: join(destination, "sessions"),
    sessionId: "profile",
    clock,
  });
  const events = evidence.records().map((row) => evidence.payloads().get(row.payloadDigest));
  const frozenEvent = events.find((row) => row.phase === "profile-frozen");
  assert.equal(frozenEvent?.digest, digestOfJson(asJsonValue(protocol)), "profile freeze changed");
  const completed = profileProgress(events);
  requireRuntimeCleanup(evidence);
  const prior = events.find((row) => row.phase === "profile-result");
  if (prior) return prior.result;
  assert.deepEqual(protocol.environment, {
    node: process.version,
    platform: platform(),
    arch: arch(),
    release: release(),
  });
  const campaign = await reportPilot(protocol.campaignRoot);
  assert.deepEqual(campaign.campaignHead, protocol.campaignHead);
  const frozen = JSON.parse(await readFile(join(protocol.campaignRoot, "frozen.json"), "utf8"));
  const candidates = protocol.selectedCases.map((id) =>
    preparedCaseSchema.parse(frozen.candidates.find((item) => item.id === id)),
  );
  assertLocalModel(await inventory(), protocol.model.name, protocol.model.digest);
  const cancellation = new AbortController();
  const stop = () => cancellation.abort(new Error("profiling interrupted"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const record = async (payload) => {
    try {
      await evidence.record({
        type: "campaign-observation",
        actor: "harness",
        provenance: ["user", "file", "tool-output"],
        payload: asJsonValue(payload),
      });
    } catch (cause) {
      cancellation.abort(cause);
      throw cause;
    }
  };
  const context = await createRunContext({
    evidence,
    clock,
    runId: "live-contention-v1",
    maxTokens: limits.tokens,
    maxWallMs: limits.wallMs,
    modelConcurrency: 2,
    testConcurrency: 2,
    signal: cancellation.signal,
  });
  const registry = createProviderRegistry({
    localBaseUrl: protocol.endpoint,
    localThinking: false,
  });
  const workspaces = candidates.map((_, index) => join(destination, `workspace-${index}`));
  const runtimes = candidates.map((candidate, index) =>
    runtimeFor({
      candidate,
      workspace: workspaces[index],
      evidence,
      signal: context.signal,
      clock,
      commandPool: context.tests,
    }),
  );
  let calls = events.filter((row) => row.phase === "profile-model-intent").length;
  const modelTask = (index) => ({
    kind: "model",
    run: async () => {
      assert(calls < limits.modelCalls, "fixed model call ceiling exhausted");
      calls++;
      const sessionId = `model-${String(calls).padStart(3, "0")}`;
      await record({ phase: "profile-model-intent", sessionId, caseId: candidates[index].id });
      const session = await openEvidenceSession({
        root: join(destination, "sessions"),
        sessionId,
        clock,
      });
      const client = context.model(
        sessionId,
        createRecordingModelClient(
          registry.create({ provider: "local", modelId: protocol.model.name }),
          session,
          { transcript: "components" },
        ),
      );
      try {
        const response = await client.generate({
          system: protocol.system,
          messages: [{ role: "user", text: candidates[index].goal }],
          tools: [],
          maxOutputTokens: protocol.maxOutputTokens,
          abortSignal: context.signal,
        });
        return {
          usageStatus: response.usageStatus ?? "unknown",
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          providerAttempts: response.providerAttempts ?? [],
          performance: response.performance ?? null,
        };
      } finally {
        await record({ phase: "profile-model-settled", sessionId, head: session.head() });
      }
    },
  });
  const testTask = (index) => ({
    kind: "tests",
    run: () =>
      runtimes[index].commands.run(
        projectGateOptions(candidates[index]).commandOverrides?.tests ?? "pytest",
        {
          cwd: workspaces[index],
          timeoutMs: Math.max(1, Math.min(180000, context.remainingWallMs())),
        },
      ),
  });
  const gitCommand = async (argv, signal = context.signal) => {
    const result = await runProcessGroup("git", argv, {
      cwd: workspaces[0],
      env: harnessChildEnvironment().variables,
      signal,
      timeoutMs: 30000,
      maxOutputBytes: 4_000_000,
    });
    if (result.startFailure || result.exitCode !== 0)
      throw new Error(result.startFailure ?? result.stderr);
    return result;
  };
  const ownedWorktrees = events
    .filter((row) => row.phase === "batch-intent" && row.batch.kind === "worktree")
    .flatMap((row) => [0, 1].map((index) => join(destination, `${row.batch.id}-${index}`)));
  const cleanWorktrees = async (signal) => {
    for (const path of ownedWorktrees) {
      const listed = await gitCommand(["worktree", "list", "--porcelain"], signal);
      if (!listed.stdout.split("\n").includes(`worktree ${path}`)) continue;
      await record({ phase: "cleanup-intent", path });
      await gitCommand(["worktree", "remove", path], signal);
      await record({ phase: "cleanup-completed", path });
    }
  };
  try {
    for (let index = 0; index < candidates.length; index++) {
      const id = `setup-${index}`;
      if (events.some((row) => row.phase === "setup-completed" && row.id === id)) continue;
      assert(
        !events.some((row) => row.phase === "setup-intent" && row.id === id),
        "interrupted setup requires reconciliation",
      );
      await record({
        phase: "setup-intent",
        id,
        candidate: candidates[index].id,
        workspace: workspaces[index],
      });
      const started = performance.now();
      await checkoutBase({
        clone: candidates[index].clone,
        baseCommit: candidates[index].baseCommit,
        workspace: workspaces[index],
        evidence,
        signal: context.signal,
      });
      if (candidates[index].language !== "python") {
        const installed = await installFromLockfile({
          workspace: workspaces[index],
          commands: runtimes[index].commands,
          timeoutMs: Math.max(1, Math.min(180000, context.remainingWallMs())),
          evidence,
          signal: context.signal,
        });
        assert(installed.succeeded, installed.detail);
      }
      await record({ phase: "setup-completed", id, durationMs: performance.now() - started });
    }
    if (ownedWorktrees.length > 0) await cleanWorktrees(context.signal);
    for (const batch of protocol.schedule) {
      if (completed.has(batch.id)) continue;
      context.signal.throwIfAborted();
      await record({ phase: "batch-intent", batch });
      const tasks =
        batch.kind === "model"
          ? [modelTask(0), modelTask(1), modelTask(0), modelTask(1)]
          : batch.kind === "tests"
            ? [testTask(0), testTask(1)]
            : batch.kind === "mixed"
              ? [modelTask(0), testTask(0), modelTask(1)]
              : [0, 1].map((index) => ({
                  kind: "worktree",
                  run: async () => {
                    const path = join(destination, `${batch.id}-${index}`);
                    ownedWorktrees.push(path);
                    const result = await gitCommand([
                      "worktree",
                      "add",
                      "--detach",
                      path,
                      candidates[0].baseCommit,
                    ]);
                    return { path, result };
                  },
                }));
      const result = await measureBatch({ batch, tasks, record, signal: context.signal });
      await record({ phase: "batch-completed", result });
      completed.set(batch.id, result);
      requireRuntimeCleanup(evidence);
      if (batch.kind === "worktree") await cleanWorktrees(context.signal);
      console.log(
        JSON.stringify({
          phase: "batch-completed",
          id: batch.id,
          durationMs: result.durationMs,
          failures: result.rows.filter((row) => row.status === "failed" || row.value?.exitCode > 0)
            .length,
          accounting: context.accounting(),
        }),
      );
    }
  } finally {
    context.dispose();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    const cleanupSignal = AbortSignal.timeout(limits.cleanupMs);
    if (ownedWorktrees.length > 0) await cleanWorktrees(cleanupSignal);
    await record({
      phase: "profile-stopped",
      modelCalls: calls,
      accounting: context.accounting(),
      completedBatches: completed.size,
    });
  }
  const result = {
    protocolDigest: frozenEvent.digest,
    sourceCommit: protocol.sourceCommit,
    batches: [...completed.values()],
    modelCalls: calls,
    accounting: context.accounting(),
    cleanup: "confirmed",
    complete: completed.size === protocol.schedule.length,
    limitations: [
      "Parent CPU excludes test children and containers; load averages describe the host, not per-container CPU.",
      "Model prompts use two natural goal descriptions with 128 output tokens, not full agent transcripts. Persistent server caches and two repetitions limit generalization.",
      "Test timing includes each command's container startup and cleanup. Dependency setup is recorded separately. No baseline source is repaired to improve profiling results.",
      "Shared versus separate mixed batches use the same two model calls and one test command. Other batches compare limits one and two with fixed order 1,2,2,1.",
    ],
  };
  const resultRecord = await evidence.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({ phase: "profile-result", result }),
  });
  await writeFile(join(destination, "result.json"), `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      complete: result.complete,
      evidence: resultRecord.record.payloadDigest,
      head: evidence.head(),
    }),
  );
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, input, destination] = process.argv.slice(2);
  if (mode === "freeze" && input && destination)
    console.log(JSON.stringify(await freezeProfile(resolve(input), resolve(destination))));
  else if (mode === "run" && input) await runProfile(resolve(input));
  else
    throw new Error(
      "Use freeze <completed-pilot> <new-output-directory> or run <frozen-profile-directory>",
    );
}
