#!/usr/bin/env node
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseCommandLine } from "./cli-options.ts";
import type { Clock } from "./core/clock.ts";
import { runAgentLoop } from "./core/loop.ts";
import type { RandomSource } from "./core/random-source.ts";
import { parseModelSpec } from "./providers/model-spec.ts";
import { createProviderRegistry } from "./providers/registry.ts";
import { createToolChokepoint } from "./tools/chokepoint.ts";
import { createStderrRecorder } from "./tools/chokepoint-record.ts";
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
  "When the work is done, reply with a summary and no tool calls.",
  "Your summary is a claim, not a result: the harness decides what actually passed.",
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

async function main(): Promise<number> {
  const options = parseCommandLine(process.argv.slice(2), {
    env: process.env,
    currentDirectory: process.cwd(),
  });
  const spec = parseModelSpec(options.modelSpec);

  if (!statSync(options.workspace, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `workspace ${options.workspace} is not a directory. Create it, or pass --workspace.`,
    );
  }

  const sandbox = createSandbox({
    workspaceRoot: options.workspace,
    homeDir: homedir(),
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [resolve(homedir(), ".swarm")],
  });

  const definitions = createWorkspaceTools(sandbox);
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
    confirm: async (request) => {
      if (!isTty) {
        process.stderr.write(
          `[chokepoint] refusing ${request.toolName} without a terminal to confirm on: ${request.detail}\n`,
        );
        return false;
      }
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await prompt.question(`Run "${request.detail}"? [y/N] `);
        return answer.trim().toLowerCase() === "y";
      } finally {
        prompt.close();
      }
    },
    recorder: createStderrRecorder((line) => {
      process.stderr.write(`${line}\n`);
    }),
  });

  const registry = createProviderRegistry({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    localBaseUrl: process.env.SWARM_LOCAL_BASE_URL,
  });

  const interruption = new AbortController();
  const onInterrupt = () => {
    interruption.abort();
  };
  process.on("SIGINT", onInterrupt);

  try {
    const outcome = await runAgentLoop(options.task, {
      model: registry.create(spec),
      toolInvoker,
      toolSchemas: definitions,
      clock: createSystemClock(),
      random: createSystemRandom(),
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

    await ui.stop();
    return outcome.stopReason === "completed" ? 0 : 1;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
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
