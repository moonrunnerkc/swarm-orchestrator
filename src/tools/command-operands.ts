import { argumentGrammars, printsItsArguments } from "./argument-grammars.ts";
import { pathsInArguments } from "./program-arguments.ts";
import type { SimpleShellCommand } from "./shell-command.ts";
import {
  inlineProgram,
  interpreterLanguage,
  pathsAWordCouldOpen,
  pathsInlineCodeCouldOpen,
} from "./shell-paths.ts";

/** Interpreters whose heredoc is another shell program, which this reader does not follow. */
const shells = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/**
 * The paths one simple command could open, or null where it cannot be read.
 *
 * A word is a path where the program opens it, which is a property of the program and the
 * position, not of the word: `sed -n '/function f/,/}/p' a.ts` opens `a.ts` and runs the rest as
 * a script, `printf '%s' /x > out` opens only `out`. Where the program is known (argument-grammars.ts),
 * its operands are offered, its patterns and printed text are not, and a script it runs is read
 * for the files it names. Any other program has every word offered, whole and in pieces, as the
 * guard always did. A redirect target is a path whatever the program.
 */
export function pathsACommandCouldOpen(one: SimpleShellCommand): readonly string[] | null {
  const program = one.executable.split("/").at(-1) ?? "";
  // A heredoc or `-c` string handed to a shell is a program this reader does not follow.
  if (
    shells.has(program) &&
    (one.heredocs.length > 0 || one.arguments.some((word) => /^-[a-z]*c[a-z]*$/.test(word)))
  ) {
    return null;
  }
  const fromArguments = pathsInArgumentsOf(program, one);
  if (fromArguments === null) {
    return null;
  }
  const language = interpreterLanguage(one.executable);
  return [
    ...new Set([
      ...fromArguments,
      // A heredoc is data for most programs and the program itself for an interpreter.
      ...(language === null
        ? []
        : one.heredocs.flatMap((body) => pathsInlineCodeCouldOpen(body, language))),
      ...one.redirects.flatMap(pathsAWordCouldOpen),
    ]),
  ];
}

function pathsInArgumentsOf(program: string, one: SimpleShellCommand): readonly string[] | null {
  if (printsItsArguments.has(program)) {
    return [];
  }
  const grammar = argumentGrammars[program];
  if (grammar !== undefined) {
    return pathsInArguments(grammar, one.arguments);
  }
  return one.arguments.flatMap((argument, index) => {
    const inline = inlineProgram(one.executable, one.arguments, index);
    return inline === null
      ? pathsAWordCouldOpen(argument)
      : pathsInlineCodeCouldOpen(argument, inline);
  });
}
