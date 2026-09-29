import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * The Claude Code hook: when the agent is about to run the project's own test command through
 * its Bash tool, the call is rewritten to `swarm-verify check`, so what the agent reads back is
 * the recorded assessment with its evidence bundle rather than raw runner output, and the
 * ledger holds what ran. Nothing runs twice: the original command is replaced, not preceded.
 * A command that already invokes the verifier passes untouched, which is the recursion guard.
 *
 * What this hook can and cannot enforce is stated rather than implied. It sees Bash tool
 * calls. It does not see subagents' calls, MCP tools, or anything a person types in a second
 * terminal, and a person editing the settings file can remove it. It is a convenience that
 * routes ordinary verification through the ledger; CI remains the boundary that authenticates
 * work, and this hook never claims otherwise.
 */
export const hookMarker = "hook run";

/** Verification commands the hook routes, matched whole after trimming; anything else passes. */
const routedCommands: ReadonlySet<string> = new Set([
  "npm test",
  "npm t",
  "npm run test",
  "npm run --silent test",
  "pnpm test",
  "pnpm run test",
  "yarn test",
  "vitest",
  "vitest run",
  "npx vitest",
  "npx vitest run",
  "jest",
  "npx jest",
  "node --test",
  "pytest",
  "pytest -q",
  "python -m pytest",
  "python3 -m pytest",
  "uv run pytest",
  "uv run --locked --no-sync python -m pytest -q",
]);

const preToolUseSchema = z.object({
  hook_event_name: z.literal("PreToolUse"),
  tool_name: z.string(),
  tool_input: z.object({ command: z.string().optional() }).passthrough(),
  cwd: z.string().optional(),
  session_id: z.string().optional(),
});

const postToolUseSchema = z.object({
  hook_event_name: z.literal("PostToolUse"),
  tool_name: z.string(),
  tool_input: z.object({ command: z.string().optional() }).passthrough(),
  tool_response: z.unknown().optional(),
  session_id: z.string().optional(),
});

export interface HookOptions {
  /** The command line that invokes this verifier, as the rewritten call should spell it. */
  readonly verifierCommand: string;
  /** Where per-session state goes; owner-only, outside any workspace. */
  readonly stateDirectory: string;
}

export interface HookOutcome {
  /** What to print on stdout, or null for nothing. */
  readonly output: Record<string, unknown> | null;
  /** A note for stderr, which the runner keeps out of the transcript. */
  readonly note: string | null;
  readonly exitCode: 0;
}

/**
 * The output filters after a routed test command, where the command is one: `npm test 2>&1 |
 * tail -5` is how an agent often asks for a test run, and leaving it alone ran the tests with no
 * record. Only `tail`, `head` and `grep` with plain arguments count as filters; anything else in
 * the pipeline, or any shell syntax beyond the pipe and `2>&1`, leaves the command untouched.
 */
export function filteredTestCommand(command: string): string | null {
  if (/[;&`$<>()\\]/.test(command.replaceAll("2>&1", ""))) return null;
  const [first, ...filters] = command.split("|").map((stage) => stage.trim());
  if (first === undefined || filters.length === 0) return null;
  if (!routedCommands.has(first.replace(/\s*2>&1$/, "").trim())) return null;
  const filter =
    /^(?:(?:tail|head)(?:\s+-n\s*\d+|\s+-\d+|\s+-n\d+)?|grep(?:\s+-[A-Za-z]+)*\s+(?:'[^']*'|"[^"]*"|[\w.:=-]+))$/;
  return filters.every((stage) => filter.test(stage)) ? filters.join(" | ") : null;
}

/** Whether a command already goes through the verifier, so the hook must not touch it. */
export function invokesTheVerifier(command: string): boolean {
  return (
    /(^|[\s/])swarm-verify(\.js)?(\s|$)/.test(command) ||
    /\bswarm\s+(check|ci|gates|verify)\b/.test(command)
  );
}

/** Read one hook event and decide. Never throws: a hook that fails must not block the agent. */
export async function runHook(input: unknown, options: HookOptions): Promise<HookOutcome> {
  const pre = preToolUseSchema.safeParse(input);
  if (pre.success) {
    const command = pre.data.tool_input.command;
    if (pre.data.tool_name !== "Bash" || command === undefined)
      return { output: null, note: null, exitCode: 0 };
    if (invokesTheVerifier(command))
      return { output: null, note: "already through swarm-verify", exitCode: 0 };
    const trimmed = command.trim();
    const piped = filteredTestCommand(trimmed);
    const routed = routedCommands.has(trimmed) || piped !== null;
    if (!routed) return { output: null, note: null, exitCode: 0 };
    const workspace = pre.data.cwd;
    const rewritten = `${options.verifierCommand} check${workspace === undefined ? "" : ` --workspace ${shellQuote(workspace)}`}${piped === null ? "" : ` 2>&1 | ${piped}`}`;
    return {
      output: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: `routed through swarm-verify so the run is recorded: ${trimmed} became ${rewritten}`,
          updatedInput: { ...pre.data.tool_input, command: rewritten },
        },
      },
      note: null,
      exitCode: 0,
    };
  }
  const post = postToolUseSchema.safeParse(input);
  if (post.success) {
    const command = post.data.tool_input.command ?? "";
    if (post.data.tool_name !== "Bash" || !invokesTheVerifier(command))
      return { output: null, note: null, exitCode: 0 };
    // Remember the last verifier outcome for this session, for a person or a later tool that asks.
    const response = post.data.tool_response;
    const text = typeof response === "string" ? response : JSON.stringify(response ?? "");
    const result = /result\s+([a-z-]+(?: [a-z-]+)*?)(?::| \(exit)/.exec(text)?.[1] ?? "unknown";
    try {
      await mkdir(options.stateDirectory, { recursive: true, mode: 0o700 });
      await writeFile(
        join(
          options.stateDirectory,
          `${(post.data.session_id ?? "unknown").replaceAll(/[^A-Za-z0-9_-]/g, "_")}.json`,
        ),
        `${JSON.stringify({ at: new Date().toISOString(), command, result })}\n`,
        { mode: 0o600 },
      );
    } catch {
      return { output: null, note: "could not record the outcome", exitCode: 0 };
    }
    return { output: null, note: `recorded ${result}`, exitCode: 0 };
  }
  return { output: null, note: null, exitCode: 0 };
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
}
interface MatcherGroup {
  matcher?: string;
  hooks?: HookEntry[];
}
type Settings = { hooks?: Record<string, MatcherGroup[]> } & Record<string, unknown>;

function ours(entry: HookEntry): boolean {
  return typeof entry.command === "string" && entry.command.endsWith(` ${hookMarker}`);
}

/** Add the two entries to a settings file, once, leaving every other hook and setting alone. */
export async function installHook(
  settingsPath: string,
  verifierCommand: string,
): Promise<{ readonly changed: boolean; readonly command: string }> {
  const command = `${verifierCommand} ${hookMarker}`;
  const settings = await readSettings(settingsPath);
  const hooks = settings.hooks ?? {};
  let changed = false;
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const groups = hooks[event] ?? [];
    const present = groups.some((group) =>
      (group.hooks ?? []).some((entry) => entry.command === command),
    );
    if (!present) {
      groups.push({ matcher: "Bash", hooks: [{ type: "command", command, timeout: 900 }] });
      changed = true;
    }
    hooks[event] = groups;
  }
  if (changed) await writeSettings(settingsPath, { ...settings, hooks });
  return { changed, command };
}

/** Remove only the entries this installer wrote; a group emptied by that is removed too. */
export async function uninstallHook(settingsPath: string): Promise<{ readonly changed: boolean }> {
  const settings = await readSettings(settingsPath);
  const hooks = settings.hooks;
  if (hooks === undefined) return { changed: false };
  let changed = false;
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map((group) => {
        const remaining = (group.hooks ?? []).filter((entry) => !ours(entry));
        if (remaining.length !== (group.hooks ?? []).length) changed = true;
        return { ...group, hooks: remaining };
      })
      .filter((group) => group.hooks.length > 0);
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (changed) {
    const next: Settings = { ...settings };
    if (Object.keys(hooks).length === 0) delete next.hooks;
    else next.hooks = hooks;
    await writeSettings(settingsPath, next);
  }
  return { changed };
}

async function readSettings(path: string): Promise<Settings> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error(`${path} does not hold a JSON object`);
    return parsed as Settings;
  } catch (cause) {
    if ((cause as { code?: string }).code === "ENOENT") return {};
    throw new Error(
      `${path} could not be read as settings: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

async function writeSettings(path: string, settings: Settings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
}
