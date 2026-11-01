import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { readShellCommand } from "../tools/shell-command.ts";
import { type CommandFact, evidenceRef, excerptBytes } from "./exchange.ts";
import { outputCap, truncate } from "./prompt.ts";

export interface CommandStep {
  /** What the model reads next turn. */
  readonly note: string;
  readonly fact: CommandFact;
  /** How many turns in a row ran this command and got this output. */
  readonly repeats: number;
}

/** Files one command can name in a digest line; the rest are left out. */
const filesKept = 12;

/** The words of a command that name files in the workspace, as paths relative to it. */
async function filesNamed(command: string, root: string): Promise<string[]> {
  const named: string[] = [];
  for (const word of new Set(readShellCommand(command)?.operands ?? [])) {
    const path = relative(root, resolve(root, word));
    if (path === "" || path.startsWith("..") || isAbsolute(path) || path.startsWith(".swarm/")) {
      continue;
    }
    const isFile = await stat(join(root, path)).then(
      (found) => found.isFile(),
      () => false,
    );
    if (isFile) named.push(path);
    if (named.length === filesKept) break;
  }
  return named;
}

/**
 * One command through the chokepoint. The ledger record the chokepoint writes holds the whole
 * output and is its evidence. Output longer than an old turn's excerpt is also copied into the
 * workspace under the record's name, where the model may read it again: the session store that
 * holds the ledger is denied to the model, because the sealed checks live there too.
 */
export async function runCommandStep(input: {
  readonly chokepoint: Chokepoint;
  readonly command: string;
  readonly step: number;
  /** Where whole outputs are copied, and the workspace root paths are shown relative to. */
  readonly outputs: { readonly directory: string; readonly root: string };
  readonly previous: {
    readonly command: string;
    readonly output: string;
    readonly repeats: number;
  };
}): Promise<CommandStep & { readonly output: string }> {
  const outcome = await input.chokepoint.run(input.command);
  const evidence = evidenceRef(outcome.record);
  const bytes = Buffer.byteLength(outcome.output);
  let saved: string | null = null;
  if (bytes > excerptBytes) {
    await mkdir(input.outputs.directory, { recursive: true });
    const path = join(input.outputs.directory, `${evidence}.txt`);
    await writeFile(path, outcome.output);
    saved = relative(input.outputs.root, path);
  }
  const same = input.command === input.previous.command && outcome.output === input.previous.output;
  const repeats = same ? input.previous.repeats + 1 : 1;
  // At temperature 0 a repeated command and its unchanged output can repeat forever.
  const again = same ? "This is the command you ran last turn, and its output is unchanged.\n" : "";
  const exitCode = outcome.decision === "allowed" ? outcome.exitCode : null;
  const status = outcome.decision === "allowed" ? `exit code: ${exitCode}` : outcome.decision;
  const where = saved !== null && bytes > outputCap ? `\n[full output: ${saved}]` : "";
  const lastLine = outcome.output.trimEnd().split("\n").at(-1)?.trim() ?? "";
  const ok = outcome.decision === "allowed" && exitCode === 0;
  return {
    note: `${again}${status}\n${truncate(outcome.output)}${where}`,
    fact: {
      step: input.step,
      command: input.command,
      decision: outcome.decision,
      exitCode,
      evidence,
      output: saved,
      files: await filesNamed(input.command, input.outputs.root),
      why: ok || lastLine.length === 0 ? null : lastLine,
    },
    repeats,
    output: outcome.output,
  };
}
