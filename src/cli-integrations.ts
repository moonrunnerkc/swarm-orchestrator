import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HookCommand, McpCommand, PreCommitCommand } from "./cli-verify-options.ts";
import { defaultSessionRoot } from "./evidence/session.ts";
import { installHook, runHook, uninstallHook } from "./integrations/claude-hook.ts";
import { describeTools, serveMcp } from "./integrations/mcp-server.ts";
import { installPreCommit, uninstallPreCommit, verifyStaged } from "./integrations/pre-commit.ts";
import { exitCodes } from "./machine-output.ts";

/**
 * The three thin integrations, each a client of this same binary: a Claude Code hook that
 * routes the agent's test command through `check`, a local MCP server over stdio, and a
 * pre-commit hook that verifies the staged tree. None of them carries verification logic; each
 * invokes the entry this process was started from, so the evidence they write is the evidence
 * every other route writes.
 */
function entryPath(): string {
  // The binary this process is: dist/swarm-verify.js when installed, src/swarm-verify.ts in a checkout.
  const main = process.argv[1];
  if (main !== undefined && /swarm-verify(\.js|\.ts)?$/.test(main)) return main;
  return fileURLToPath(new URL("./swarm-verify.js", import.meta.url));
}

function verifierCommand(entry: string): string {
  const quote = (value: string) =>
    /^[A-Za-z0-9_./-]+$/.test(value) ? value : JSON.stringify(value);
  return `${quote(process.execPath)} ${quote(entry)}`;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function hook(options: HookCommand): Promise<number> {
  const entry = entryPath();
  if (options.step === "help") {
    out(
      "swarm-verify hook install [--scope project|user] [--settings <file>]   add the PreToolUse and PostToolUse entries",
    );
    out(
      "swarm-verify hook uninstall [--scope project|user] [--settings <file>] remove only those entries",
    );
    out(
      "swarm-verify hook run                                                  read one hook event on stdin (what the entries call)",
    );
    out("");
    out(
      "The hook sees Bash tool calls only: a recognised test command becomes `swarm-verify check`,",
    );
    out("run once, recorded. Subagents, MCP tools and other terminals are not intercepted; CI is");
    out("the boundary that authenticates work.");
    return exitCodes.acceptable;
  }
  const settingsPath =
    options.settingsPath ??
    (options.scope === "user"
      ? join(homedir(), ".claude", "settings.json")
      : join(options.workspace, ".claude", "settings.json"));
  if (options.step === "install") {
    const installed = await installHook(settingsPath, verifierCommand(entry));
    out(
      `${installed.changed ? "installed" : "already present"}: ${installed.command} in ${settingsPath}`,
    );
    out(
      "events: PreToolUse and PostToolUse on the Bash tool. Remove with `swarm-verify hook uninstall`.",
    );
    return exitCodes.acceptable;
  }
  if (options.step === "uninstall") {
    const removed = await uninstallHook(settingsPath);
    out(`${removed.changed ? "removed" : "nothing of ours"} in ${settingsPath}`);
    return exitCodes.acceptable;
  }
  const raw = await readStdin();
  let input: unknown = null;
  try {
    input = raw.trim().length === 0 ? null : JSON.parse(raw);
  } catch {
    process.stderr.write("swarm-verify hook: the event on stdin is not JSON; nothing decided\n");
    return exitCodes.acceptable;
  }
  const outcome = await runHook(input, {
    verifierCommand: verifierCommand(entry),
    stateDirectory: join(defaultSessionRoot(homedir()), "..", "hooks"),
  });
  if (outcome.note !== null) process.stderr.write(`swarm-verify hook: ${outcome.note}\n`);
  if (outcome.output !== null) process.stdout.write(`${JSON.stringify(outcome.output)}\n`);
  return outcome.exitCode;
}

function readStdin(): Promise<string> {
  return new Promise((settle) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      text += chunk;
    });
    process.stdin.on("end", () => settle(text));
    process.stdin.on("error", () => settle(text));
    if (process.stdin.isTTY) settle("");
  });
}

async function mcp(options: McpCommand): Promise<number> {
  if (options.describe) {
    out(describeTools());
    return exitCodes.acceptable;
  }
  await serveMcp({
    root: options.root,
    sessionRoot: defaultSessionRoot(homedir()),
    entry: entryPath(),
    home: homedir(),
    write: (line) => process.stdout.write(`${line}\n`),
    log: (line) => process.stderr.write(`swarm-verify mcp: ${line}\n`),
  });
  return exitCodes.acceptable;
}

async function preCommit(options: PreCommitCommand): Promise<number> {
  const entry = entryPath();
  if (options.step === "install") {
    const installed = await installPreCommit(options.workspace, entry);
    if (installed.state === "foreign") {
      out(
        `a pre-commit hook that is not ours is at ${installed.path}; add this line to it rather than replacing it:`,
      );
      out(`  ${installed.line}`);
      return exitCodes.notAcceptable;
    }
    out(`${installed.state === "installed" ? "installed" : "already present"}: ${installed.path}`);
    out(
      "verifies the staged tree before each commit; `git commit --no-verify` skips it, and CI stays the boundary.",
    );
    return exitCodes.acceptable;
  }
  if (options.step === "uninstall") {
    const removed = await uninstallPreCommit(options.workspace);
    out(`${removed.state}: ${removed.path}`);
    return removed.state === "foreign" ? exitCodes.notAcceptable : exitCodes.acceptable;
  }
  const verified = await verifyStaged({
    repository: options.workspace,
    entry,
    json: options.json,
    home: homedir(),
  });
  for (const line of verified.lines) out(line);
  return verified.exitCode;
}

/** Dispatch one integration command. */
export async function integration(
  options: HookCommand | McpCommand | PreCommitCommand,
): Promise<number> {
  if (options.command === "hook") return hook(options);
  if (options.command === "mcp") return mcp(options);
  return preCommit(options);
}
