import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Chokepoint } from "../tools/chokepoint.ts";
import type { CommandFact } from "./context.ts";
import { outputCap, truncate } from "./prompt.ts";

export interface CommandStep {
  /** What the model reads next turn. */
  readonly note: string;
  readonly fact: CommandFact;
  /** How many turns in a row ran this command and got this output. */
  readonly repeats: number;
}

/**
 * One command through the chokepoint. Output longer than a turn carries is written whole to the
 * output directory and the turn names the file, so nothing the model may need is lost from the
 * record while the prompt carries only its start and end.
 */
export async function runCommandStep(input: {
  readonly chokepoint: Chokepoint;
  readonly command: string;
  readonly step: number;
  /** Where full outputs go, and the directory paths are shown relative to. */
  readonly outputs: { readonly directory: string; readonly root: string } | null;
  readonly previous: {
    readonly command: string;
    readonly output: string;
    readonly repeats: number;
  };
}): Promise<CommandStep & { readonly output: string }> {
  const outcome = await input.chokepoint.run(input.command);
  let saved: string | null = null;
  if (input.outputs !== null && Buffer.byteLength(outcome.output) > outputCap) {
    await mkdir(input.outputs.directory, { recursive: true });
    const path = join(input.outputs.directory, `${input.step}.txt`);
    await writeFile(path, outcome.output);
    saved = relative(input.outputs.root, path);
  }
  const same = input.command === input.previous.command && outcome.output === input.previous.output;
  const repeats = same ? input.previous.repeats + 1 : 1;
  // At temperature 0 a repeated command and its unchanged output can repeat forever.
  const again = same ? "This is the command you ran last turn, and its output is unchanged.\n" : "";
  const status =
    outcome.decision === "allowed" ? `exit code: ${outcome.exitCode}` : outcome.decision;
  const where = saved === null ? "" : `\n[full output: ${saved}]`;
  return {
    note: `${again}${status}\n${truncate(outcome.output)}${where}`,
    fact: {
      step: input.step,
      command: input.command,
      exitCode: outcome.decision === "allowed" ? outcome.exitCode : null,
      output: saved,
    },
    repeats,
    output: outcome.output,
  };
}
