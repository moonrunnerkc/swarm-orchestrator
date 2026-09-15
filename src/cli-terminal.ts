import { spawn } from "node:child_process";
import { platform } from "node:os";
import { createInterface } from "node:readline/promises";
import type { ResolvedSettings } from "./config/settings.ts";
import type { Clock } from "./core/clock.ts";
import { resolveKeyBindings } from "./tui/key-bindings.ts";
import { type OpenCommand, openEnvironment } from "./tui/open-path.ts";
import type { SessionInterface } from "./tui/session-interface.ts";
import { resolveTheme } from "./tui/theme.ts";

/**
 * Everything ambient the screen needs, gathered here so nothing below the composition root
 * reads a terminal, an environment variable, or the clock (invariant 8).
 */
export async function startInterface(input: {
  readonly task: string;
  readonly workspace: string;
  readonly settings: ResolvedSettings;
  readonly clock: Clock;
}): Promise<SessionInterface> {
  const { startSessionInterface } = await import("./tui/session-interface.ts");
  const isTty = process.stdout.isTTY === true && process.stdin.isTTY === true;
  const ui = input.settings.interface;

  return startSessionInterface({
    task: input.task,
    workspace: input.workspace,
    isTty,
    interactive: ui.tui,
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
    writeError: (line) => {
      process.stderr.write(`${line}\n`);
    },
    clock: input.clock,
    theme: resolveTheme({
      mode: ui.color,
      term: process.env.TERM,
      noColorSet: process.env.NO_COLOR !== undefined,
      isTty,
      palette: ui.theme,
    }),
    bindings: resolveKeyBindings(ui.keys),
    ...(isTty ? { askOnTerminal } : {}),
    readLine: readTaskLine,
    openEvidence: ui.openEvidence,
    confirmTimeoutMs: ui.confirmTimeoutMs,
    spawnOpen: spawnOpener,
    platform: platform(),
  });
}

/**
 * One readline for the whole session, opened when the first task is asked for.
 *
 * Kept open rather than opened per question, because a fresh interface per line loses whatever
 * is already buffered from a pipe, and a piped session is a list of tasks somebody wrote down.
 * Null at end of input is what ends the session.
 */
let taskReader: ReturnType<typeof createInterface> | null = null;

let taskLines: AsyncIterator<string> | null = null;

async function readTaskLine(prompt: string): Promise<string | null> {
  if (taskReader === null) {
    taskReader = createInterface({ input: process.stdin, output: process.stderr });
    taskLines = taskReader[Symbol.asyncIterator]();
  }
  if (process.stdin.isTTY === true) {
    process.stderr.write(prompt);
  }
  const next = await taskLines?.next();
  if (next === undefined || next.done === true) {
    return null;
  }
  return next.value;
}

/** Readline, on the plain path only. Ink owns stdin whenever the screen is up. */
export async function askOnTerminal(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

/**
 * An argument vector, spawned with no shell in between and under an environment built rather
 * than inherited. The path is one argument, so nothing in it is read as syntax by anything.
 */
function spawnOpener(command: OpenCommand): Promise<number | null> {
  return new Promise((settle, fail) => {
    const child = spawn(command.file, [...command.args], {
      env: openEnvironment(process.env),
      stdio: "ignore",
      detached: false,
    });
    child.on("error", fail);
    child.on("exit", (code) => {
      settle(code);
    });
  });
}

export function closeTaskReader(): void {
  taskReader?.close();
  taskReader = null;
  taskLines = null;
}
