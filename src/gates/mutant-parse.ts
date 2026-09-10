import type { CommandOptions, GateCommandRunner } from "./gate-definition.ts";
import type { MutantOperator } from "./oracle-mutants.ts";

/**
 * Whether a mutant is a mutant, or a file that no longer compiles.
 *
 * A syntax error is refused by every oracle there is, and a bond that counted that refusal would
 * credit the oracle with a rejection it never made. So the one operator that can produce one is
 * held to a check before its result is read.
 */
export type ParseCheckReading = "usable" | "syntax-error" | "dialect-unreadable";

/**
 * Which operators can turn a file that parsed into one that does not.
 *
 * Only the one that removes a line. Every other operator replaces a token with a token of the
 * same shape, wraps a balanced region in a negation, or removes a balanced one, and none of those
 * can unbalance the file. Statement deletion is different in kind: what looks like a whole
 * statement on one line can be the middle of an expression the line above it opened, and no
 * lexical reading of a single line settles that.
 */
export function mustBeShownToParse(operator: MutantOperator): boolean {
  return operator === "delete-statement";
}

/**
 * The check read differentially, because a checker that cannot read the file it started from
 * cannot tell a syntax error from a mutant.
 *
 * The abstention is the fail-closed answer and it costs coverage rather than correctness: in a
 * file this checker cannot read, statement deletion proposes nothing and the other operators are
 * unaffected.
 */
export function readParseCheck(input: {
  readonly originalParses: boolean;
  readonly mutantParses: boolean;
}): ParseCheckReading {
  if (!input.originalParses) {
    return "dialect-unreadable";
  }
  return input.mutantParses ? "usable" : "syntax-error";
}

/**
 * Whether node can parse a file, asked of node rather than of a parser written here.
 *
 * `node --check` reads a file and reports a syntax error without executing a line of it, which is
 * the whole of what this needs and none of what running the file would cost. It reads JavaScript,
 * module syntax in a `.js` file included, and refuses TypeScript and JSX. That is the residual,
 * and `mutant-parse.test.ts` runs each of those dialects rather than asserting them.
 *
 * The program is named rather than pathed, for the reason `IsolationBackend` names it: the host's
 * own binary path means nothing where a container runs the command.
 */
export function nodeSyntaxCheck(
  commands: GateCommandRunner,
  options: Pick<CommandOptions, "cwd" | "timeoutMs">,
): (file: string) => Promise<boolean> {
  return async (file: string): Promise<boolean> => {
    const observed = await commands.runVouched(["node", "--check", file], {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
    });
    return observed.exitCode === 0;
  };
}
