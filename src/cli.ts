#!/usr/bin/env node
import { statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type CommandLine,
  parseCommandLine,
  type ReplayCommand,
  type RunCommand,
} from "./cli-options.ts";
import type { Clock } from "./core/clock.ts";
import { runAgentLoop } from "./core/loop.ts";
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
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
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
  "Read before you edit. Make the smallest change that satisfies the task.",
  "Every tool result ends with an [evidence record sha256:...] trailer naming the ledger record it produced.",
  "To assert that work is done, call the claim tool with a predicate over such a record,",
  'for example predicate "facts.exitCode == 0" citing the record of the test command you ran.',
  "The harness evaluates the predicate and decides the verdict; your prose never counts as a result.",
  "When the work is done, reply with a summary and no tool calls.",
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

  const definitions = [...createWorkspaceTools(sandbox), createClaimTool(evidence, model.modelId)];
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

    await ui.stop();
    const directory = await writeBundle(evidence, options.bundleDirectory, clock);
    process.stdout.write(`\nevidence bundle: ${directory}\n`);
    process.stdout.write(
      `verify it anywhere: node ${join(directory, "verify.mjs")} ${directory}\n`,
    );
    process.stdout.write(`review it: open ${join(directory, "review.html")}\n`);
    return outcome.stopReason === "completed" ? 0 : 1;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
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
  return options.command === "replay" ? replay(options) : run(options);
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
