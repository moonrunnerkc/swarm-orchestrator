#!/usr/bin/env node
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type CommandLine,
  type GatesCommand,
  parseCommandLine,
  type ReplayCommand,
  type RunCommand,
  type SelectCommand,
} from "./cli-options.ts";
import type { Clock } from "./core/clock.ts";
import { runAgentLoop } from "./core/loop.ts";
import type { LoopEvent } from "./core/loop-events.ts";
import type { RandomSource } from "./core/random-source.ts";
import { bundleSourceFromRecorder, exportBundle } from "./evidence/bundle.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { replayBundle } from "./evidence/replay.ts";
import {
  createSessionId,
  defaultSessionRoot,
  type EvidenceRecorder,
  openEvidenceSession,
} from "./evidence/session.ts";
import { createKeychainSecretStore, resolveSigningKey } from "./evidence/signing.ts";
import type { AutoResolveOutcome, ResolveRequest } from "./gates/auto-resolve.ts";
import { runGatesEngine } from "./gates/engine.ts";
import { describeEscalation } from "./gates/escalation.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import { createAmendFileSetTool, createDeclareFileSetTool } from "./gates/file-set-tool.ts";
import { citedRecords, type GateCycle, outstandingJustifications } from "./gates/gate-runner.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { probeHardware } from "./select/hardware-probe.ts";
import { recommendModel } from "./select/recommendation.ts";
import { renderSelectReport } from "./select/select-report.ts";
import { loadShortlist } from "./select/shortlist-source.ts";
import { systemProbeEnvironment } from "./select/system-probe.ts";
import { createToolChokepoint } from "./tools/chokepoint.ts";
import { createLedgerChokepointRecorder } from "./tools/chokepoint-record.ts";
import { createClaimTool } from "./tools/claim-tool.ts";
import { createDerivationHeuristic } from "./tools/derivation.ts";
import { createSandbox } from "./tools/sandbox.ts";
import { createWorkspaceTools } from "./tools/workspace-tools.ts";
import { startSessionInterface } from "./tui/session-interface.ts";

const defaultShellAllowlist = [
  "cat",
  "git",
  "grep",
  "head",
  "ls",
  "node",
  "npm",
  "npx",
  "pwd",
  "sed",
  "tail",
  "wc",
];

const systemPrompt = [
  "You are a coding agent working inside one workspace directory.",
  "State a short plan on your first turn, then use the tools to carry it out.",
  "Before you edit anything, call declare_file_set with the files you intend to touch:",
  "a change to a file outside that set fails the file-set gate. If the work turns out to need",
  "another file, call amend_file_set with a reason a reviewer will read.",
  "Read before you edit. Make the smallest change that satisfies the task.",
  "Every tool result ends with an [evidence record sha256:...] trailer naming the ledger record it produced.",
  "To assert that work is done, call the claim tool with a predicate over such a record,",
  'for example predicate "facts.exitCode == 0" citing the record of the test command you ran.',
  "The harness evaluates the predicate and decides the verdict; your prose never counts as a result.",
  "When the work is done, reply with a summary and no tool calls.",
  "Quality gates then run against the workspace. If one fails you will be given its raw output",
  "and asked to fix it. Fixes are measured: removing tests, removing assertions, adding skip",
  "markers, or lowering coverage of the lines you changed gets the attempt rejected outright.",
].join(" ");

/** The ambient clock lives at the composition root; src/core only ever sees the port. */
function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (milliseconds) =>
      new Promise((resolveSleep) => {
        setTimeout(resolveSleep, milliseconds);
      }),
  };
}

function createSystemRandom(): RandomSource {
  return { next: () => Math.random() };
}

async function replay(options: ReplayCommand): Promise<number> {
  for (const line of await replayBundle(options.bundleDirectory)) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}

/** Long enough for a cold CDN, short enough that the bundled snapshot takes over quickly. */
const shortlistFetchTimeoutMs = 4_000;

/**
 * No model, no ledger: every number this prints came off the machine or out of the shortlist,
 * so there is no claim here for evidence to answer.
 */
async function select(options: SelectCommand): Promise<number> {
  const profile = await probeHardware(systemProbeEnvironment());
  const loaded = await loadShortlist({
    fetch: (url) => fetch(url, { signal: AbortSignal.timeout(shortlistFetchTimeoutMs) }),
    readFile: (path) => readFile(path, "utf8"),
    requested: options.shortlist,
  });
  const recommendation = recommendModel(profile, loaded.shortlist);

  for (const line of renderSelectReport({ profile, loaded, recommendation })) {
    process.stdout.write(`${line}\n`);
  }
  return recommendation.outcome === "model" ? 0 : 1;
}

async function run(options: RunCommand): Promise<number> {
  const spec = parseModelSpec(options.modelSpec);

  if (!statSync(options.workspace, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `workspace ${options.workspace} is not a directory. Create it, or pass --workspace.`,
    );
  }

  const clock = createSystemClock();
  const random = createSystemRandom();
  const sessionRoot = defaultSessionRoot(homedir());
  const evidence = await openEvidenceSession({
    root: sessionRoot,
    sessionId: createSessionId(clock, random),
    clock,
  });

  const sandbox = createSandbox({
    workspaceRoot: options.workspace,
    homeDir: homedir(),
    shellAllowlist: defaultShellAllowlist,
    // The session store is denied to tools: evidence the subject can reach is not evidence.
    deniedRoots: [resolve(homedir(), ".swarm")],
  });

  const registry = createProviderRegistry({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    localBaseUrl: process.env.SWARM_LOCAL_BASE_URL,
  });
  const model = createRecordingModelClient(registry.create(spec), evidence);
  const fileSet = createFileSetRegistry(evidence);

  const definitions = [
    ...createWorkspaceTools(sandbox),
    createClaimTool(evidence, model.modelId),
    createDeclareFileSetTool(fileSet, model.modelId),
    createAmendFileSetTool(fileSet, model.modelId),
  ];
  const isTty = process.stdout.isTTY === true && process.stdin.isTTY === true;

  const ui = startSessionInterface({
    task: options.task,
    isTty,
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });

  const toolInvoker = createToolChokepoint({
    definitions,
    sandbox,
    derivation: createDerivationHeuristic(),
    confirm: async (request) => {
      if (!isTty) {
        process.stderr.write(
          `[chokepoint] refusing ${request.toolName} without a terminal to confirm on: ${request.explanation}\n`,
        );
        return false;
      }
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        process.stderr.write(`${request.explanation}\n`);
        const answer = await prompt.question(`Run "${request.detail}"? [y/N] `);
        return answer.trim().toLowerCase() === "y";
      } finally {
        prompt.close();
      }
    },
    recorder: createLedgerChokepointRecorder(evidence),
  });

  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: {
      task: options.task,
      workspace: options.workspace,
      modelSpec: options.modelSpec,
      maxSteps: options.maxSteps,
      baseRef: options.baseRef,
      attemptCap: options.attempts,
    },
  });

  const interruption = new AbortController();
  const onInterrupt = () => {
    interruption.abort();
  };
  process.on("SIGINT", onInterrupt);

  try {
    const outcome = await runAgentLoop(options.task, {
      model,
      toolInvoker,
      toolSchemas: definitions,
      clock,
      random,
      emit: (event) => {
        ui.emit(event);
      },
      budget: {
        maxSteps: options.maxSteps,
        maxTokens: 1_000_000,
        maxWallTimeMs: 30 * 60 * 1000,
      },
      abortSignal: interruption.signal,
      systemPrompt,
      maxOutputTokens: 8192,
      retryPolicy: { attempts: 3, baseDelayMs: 500, maxJitterRatio: 0.5 },
    });

    await evidence.record({
      type: "session-stopped",
      actor: "harness",
      // The stop reason is the harness's; the narrative in it came from the model.
      provenance: ["model"],
      payload: {
        stopReason: outcome.stopReason,
        steps: outcome.steps,
        tokensUsed: outcome.tokensUsed,
        // Recorded as what it is: the model's account, never a result.
        completionNarrative: outcome.completionClaim,
      },
    });

    // The model has said it is done. Nothing about that is a result yet: the gates run now,
    // and what they measure is what decides the exit code.
    const gates = await runGatesEngine({
      workspaceRoot: options.workspace,
      baseRef: options.baseRef,
      evidence,
      fileSet,
      clock,
      emit: (event) => {
        ui.emit(event);
      },
      cap: options.attempts,
      resolve: (request) =>
        resolveWithModel(request, {
          task: options.task,
          model,
          toolInvoker,
          definitions,
          clock,
          random,
          emit: (event) => {
            ui.emit(event);
          },
          maxSteps: options.maxSteps,
          abortSignal: interruption.signal,
        }),
    });

    await ui.stop();
    reportGates(gates.outcome, evidence);
    const directory = await writeBundle(evidence, options.bundleDirectory, clock);
    announceBundle(directory);
    return outcome.stopReason === "completed" && gates.outcome.settled === "green" ? 0 : 1;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

/**
 * One attempt at fixing what a gate reported. A fresh loop rather than a continued one: the
 * gate output is the whole brief, and starting clean keeps an attempt from inheriting the
 * reasoning that produced the failure.
 */
interface ResolveDependencies {
  readonly task: string;
  readonly model: Parameters<typeof runAgentLoop>[1]["model"];
  readonly toolInvoker: Parameters<typeof runAgentLoop>[1]["toolInvoker"];
  readonly definitions: Parameters<typeof runAgentLoop>[1]["toolSchemas"];
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly emit: (event: LoopEvent) => void;
  readonly maxSteps: number;
  readonly abortSignal: AbortSignal;
}

async function resolveWithModel(request: ResolveRequest, deps: ResolveDependencies): Promise<void> {
  const brief = [
    `The task was: ${deps.task}`,
    "",
    `A quality gate is failing. This is attempt ${request.attempt} of ${request.cap}.`,
    "Fix the cause. Do not weaken the tests: removing a test, removing an assertion, adding a",
    "skip marker, or lowering coverage of the lines you changed will have the attempt rejected",
    "and will still cost you the attempt.",
    "",
    request.gateOutput,
  ].join("\n");

  await runAgentLoop(brief, {
    model: deps.model,
    toolInvoker: deps.toolInvoker,
    toolSchemas: deps.definitions,
    clock: deps.clock,
    random: deps.random,
    emit: deps.emit,
    budget: { maxSteps: deps.maxSteps, maxTokens: 1_000_000, maxWallTimeMs: 30 * 60 * 1000 },
    abortSignal: deps.abortSignal,
    systemPrompt,
    maxOutputTokens: 8192,
    retryPolicy: { attempts: 3, baseDelayMs: 500, maxJitterRatio: 0.5 },
  });
}

function describeCycle(cycle: GateCycle): string {
  return cycle.runs
    .map((gate) => {
      const label = gate.status === "not-applicable" ? "n/a" : gate.status;
      const advisory = gate.severity === "advisory" ? " (advisory)" : "";
      return `  ${label.padEnd(8)} ${gate.gateId}${advisory}: ${gate.detail}`;
    })
    .join("\n");
}

function reportGates(outcome: AutoResolveOutcome, evidence: EvidenceRecorder): void {
  process.stdout.write(`\ngates:\n${describeCycle(outcome.finalCycle)}\n`);

  for (const attempt of outcome.attempts) {
    process.stdout.write(
      `attempt ${attempt.attempt}: ${attempt.decision.accepted ? "accepted" : "REJECTED"} - ` +
        `${attempt.decision.detail}\n`,
    );
  }

  for (const run of outstandingJustifications(outcome.finalCycle, citedRecords(evidence))) {
    process.stdout.write(
      `\nthe ${run.gateId} gate asked for a justification and no claim cites its record ` +
        `${run.record}. This does not block, and the bundle shows it unanswered.\n`,
    );
  }

  if (outcome.escalation !== null) {
    process.stderr.write(`\n${describeEscalation(outcome.escalation)}\n`);
  }
}

function announceBundle(directory: string): void {
  process.stdout.write(`\nevidence bundle: ${directory}\n`);
  process.stdout.write(`verify it anywhere: node ${join(directory, "verify.mjs")} ${directory}\n`);
  process.stdout.write(`review it: open ${join(directory, "review.html")}\n`);
}

/** The gates on their own: no model, no retries, just what the workspace measures right now. */
async function gates(options: GatesCommand): Promise<number> {
  const clock = createSystemClock();
  const random = createSystemRandom();
  const evidence = await openEvidenceSession({
    root: defaultSessionRoot(homedir()),
    sessionId: createSessionId(clock, random),
    clock,
  });
  const fileSet = createFileSetRegistry(evidence);

  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: { task: "gates", workspace: options.workspace, baseRef: options.baseRef },
  });

  const run = await runGatesEngine({
    workspaceRoot: options.workspace,
    baseRef: options.baseRef,
    evidence,
    fileSet,
    clock,
    emit: () => {},
    // No retries are offered, so none are spent: this command measures and reports.
    cap: 0,
    resolve: () => Promise.reject(new Error("swarm gates reports; it does not fix")),
  });

  process.stdout.write(
    `project: ${run.detection.types.join(", ") || "no manifest detected"}\n\n` +
      `${describeCycle(run.outcome.firstCycle)}\n`,
  );
  for (const gate of outstandingJustifications(run.outcome.firstCycle, citedRecords(evidence))) {
    process.stdout.write(`\nthe ${gate.gateId} gate asked for a justification: ${gate.detail}\n`);
  }
  announceBundle(await writeBundle(evidence, options.bundleDirectory, clock));
  return run.outcome.firstCycle.blockingFailures.length === 0 ? 0 : 1;
}

async function writeBundle(
  evidence: EvidenceRecorder,
  destination: string | null,
  clock: Clock,
): Promise<string> {
  const signing = await resolveSigningKey(createKeychainSecretStore({ platform: platform() }));
  if (signing.notice !== null) {
    process.stderr.write(`[signing] ${signing.notice}\n`);
  }
  const directory = destination ?? join(evidence.directory, "bundle");
  await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination: directory,
    signingKey: signing.key,
    clock,
  });
  return directory;
}

async function main(): Promise<number> {
  const options: CommandLine = parseCommandLine(process.argv.slice(2), {
    env: process.env,
    currentDirectory: process.cwd(),
  });
  if (options.command === "replay") {
    return replay(options);
  }
  if (options.command === "select") {
    return select(options);
  }
  return options.command === "gates" ? gates(options) : run(options);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
