import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { editText, type FileEdit } from "../tools/file-edit.ts";
import { readShellCommand } from "../tools/shell-command.ts";
import { comparableOutput } from "./comparable-output.ts";
import { type CommandFact, evidenceRef, excerptBytes } from "./exchange.ts";
import { outputCap, truncate } from "./prompt.ts";

export interface CommandStep {
  /** What the model reads next turn. */
  readonly note: string;
  readonly fact: CommandFact;
  /** How many turns in a row ran this command and got this result. */
  readonly repeats: number;
  /** The output as the no-progress rule compares it, with clocks and durations taken out. */
  readonly comparable: string;
  /** For an edit, what an old turn shows in place of a long block; null for a command. */
  readonly brief: string | null;
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
  /** A shell command, or an edit block, which goes through the same chokepoint. */
  readonly action: { readonly command: string } | { readonly edit: FileEdit };
  readonly step: number;
  /** Where whole outputs are copied, and the workspace root paths are shown relative to. */
  readonly outputs: { readonly directory: string; readonly root: string };
  readonly previous: {
    readonly command: string;
    readonly comparable: string;
    readonly repeats: number;
  };
  /** The authored checks' paths: in the tree only while the harness runs them. */
  readonly withheld?: readonly string[];
}): Promise<CommandStep & { readonly output: string }> {
  const isEdit = "edit" in input.action;
  const command = "edit" in input.action ? editText(input.action.edit) : input.action.command;
  const outcome =
    "edit" in input.action
      ? await input.chokepoint.edit(input.action.edit)
      : await input.chokepoint.run(input.action.command);
  const evidence = evidenceRef(outcome.record);
  const bytes = Buffer.byteLength(outcome.output);
  let saved: string | null = null;
  if (bytes > excerptBytes) {
    await mkdir(input.outputs.directory, { recursive: true });
    const path = join(input.outputs.directory, `${evidence}.txt`);
    await writeFile(path, outcome.output);
    saved = relative(input.outputs.root, path);
  }
  // A runner that prints its clock never prints the same bytes twice, so the result is compared
  // without clocks, durations and temporary paths.
  const comparable = comparableOutput(outcome.output);
  const same = command === input.previous.command && comparable === input.previous.comparable;
  const repeats = same ? input.previous.repeats + 1 : 1;
  // At temperature 0 a repeated command and its unchanged output can repeat forever.
  const again = same
    ? `This is the ${isEdit ? "edit you sent" : "command you ran"} last turn, and its result is unchanged (times and durations aside).\n`
    : "";
  const exitCode = outcome.decision === "allowed" ? outcome.exitCode : null;
  const status = outcome.decision === "allowed" ? `exit code: ${exitCode}` : outcome.decision;
  const where = saved !== null && bytes > outputCap ? `\n[full output: ${saved}]` : "";
  const lastLine = outcome.output.trimEnd().split("\n").at(-1)?.trim() ?? "";
  const ok = outcome.decision === "allowed" && exitCode === 0;
  // claimcheck (2026-11-05, rc.13): the model read the authored test's path three times, was told
  // no such file each time, and the run stopped there.
  const named = isEdit
    ? []
    : (input.withheld ?? []).filter((path) => command.includes(basename(path)));
  const withheld = named.map(
    (path) =>
      `\n[${path} is the independent check written apart from your change. The harness withholds its source and lays it in only while it runs it, so it is not in the tree. What it reports after each change, its failing cases and their errors, is in the checks note; change the code until they pass.]`,
  );
  return {
    note: `${again}${status}\n${truncate(outcome.output)}${where}${withheld.join("")}`,
    fact: {
      step: input.step,
      command,
      decision: outcome.decision,
      exitCode,
      evidence,
      output: saved,
      files:
        "edit" in input.action
          ? [input.action.edit.path]
          : await filesNamed(input.action.command, input.outputs.root),
      why: ok || lastLine.length === 0 ? null : lastLine,
    },
    repeats,
    comparable,
    brief:
      "edit" in input.action
        ? `(a ${input.action.edit.mode} block for ${input.action.edit.path}; not repeated here)`
        : null,
    output: outcome.output,
  };
}
