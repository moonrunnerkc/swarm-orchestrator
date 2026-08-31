import { basename } from "node:path";
import { readShellPipeline } from "./shell-command.ts";

/**
 * A shell command reduced to what it does to what, so two spellings of one command compare
 * equal.
 *
 * The derivation heuristic matches text, and text is exactly what a rephrase changes. A command
 * copied out of a file with flags inserted and `sh` swapped for `bash` shares almost no tokens
 * with what was read, so neither containment nor n-gram overlap reaches the threshold, and
 * lowering the threshold to catch it flags every ordinary command that happens to mention a
 * filename someone read. That is build-guide section 7.1's fourth residual, and it is a
 * property of comparing spellings rather than of the threshold.
 *
 * So the comparison moves off the spelling. What survives a rephrase is the program and the
 * things it was pointed at: inserting `-fsSL` does not change which URL is fetched, and handing
 * the result to bash rather than sh does not change that it is handed to a shell. What a
 * rephrase cannot preserve is the operand, because the operand is the point of the command.
 *
 * Flags are read so they can be told from operands, and then dropped. Dropping them is the
 * whole mechanism: `curl -fsSL X` and `curl X` fetch the same X, and provenance is a question
 * about X. Nothing here decides whether a command is safe, which is the allowlist's job and is
 * decided on the programs rather than on this.
 */

/** Interpreters that differ in features and not in what handing them a script means. */
const shellAliases: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);

/**
 * A leading `-x` bundle expanded into its letters, so `-fsSL` reads as four flags rather than
 * as one operand. Long flags are left as written: a long flag's value can be its own argument
 * or ride behind an equals sign, and splitting on the equals sign is the guess this file avoids.
 */
function isFlag(argument: string): boolean {
  return argument.startsWith("-") && argument.length > 1;
}

/** The name a program is known by, whatever path it was reached through. */
function programName(executable: string): string {
  const name = basename(executable);
  return shellAliases.has(name) ? "sh" : name;
}

export interface CanonicalCommand {
  readonly program: string;
  /** Everything that is not a flag, in the order it was written. */
  readonly operands: readonly string[];
}

/**
 * The pipeline as a list of canonical commands, or null where the string is one this cannot
 * read at all. Null is the honest answer: a string carrying a substitution means whatever the
 * shell decides it means, and comparing a guess at it to anything proves nothing.
 */
export function canonicalCommands(command: string): readonly CanonicalCommand[] | null {
  const pipeline = readShellPipeline(command);
  if (pipeline === null) {
    return null;
  }
  return pipeline.map((one) => ({
    program: programName(one.executable),
    operands: one.arguments.filter((argument) => !isFlag(argument)),
  }));
}

/** One line of a canonical form, for comparing and for reading in a record. */
export function renderCanonical(one: CanonicalCommand): string {
  return [one.program, ...one.operands].join(" ");
}

/**
 * The canonical forms in a piece of text, one per line that reads as a command. Content read
 * from a file is prose with commands in it rather than a command, so every line is tried and
 * the ones that are not commands simply produce nothing.
 */
export function canonicalFormsIn(text: string): ReadonlySet<string> {
  const forms = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    for (const one of canonicalCommands(trimmed) ?? []) {
      forms.add(renderCanonical(one));
    }
  }
  return forms;
}
