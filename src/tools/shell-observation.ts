import { basename } from "node:path";
import { readShellStages, type ShellStage } from "./shell-command.ts";

/**
 * What a shell command's result can say about the tree it ran on.
 *
 * A command that only prints the workspace (`ls`, `sed -n`, `git diff`) inspects it: its exit
 * status says the command ran, never that a requirement holds, and `grep` exits 1 for "no match".
 * Anything else is read as a check of something, keyed by its subject, so one check's result is
 * only ever compared with a later run of the same check. Held-out block 1's entities repair loop
 * had `npm run lint` exit 1 on its current tree and then `sed -n` exit 0, and the decision point
 * read the second as the tree's latest result and continued past the open lint failure.
 *
 * Whether the command wrote files is not decided here: the harness measures the workspace around
 * every shell command instead (src/agent-workspace-effects.ts). This only reads whose exit status
 * the shell reports, from the same tokenizer the guard uses, and errs towards "unknown": a status
 * the shell reports for some other command than the check is not the check's.
 */
export interface ShellObservation {
  readonly kind: "inspection" | "check";
  /** The command with workspace changes of directory and trailing filters dropped. */
  readonly subject: string;
  /** False where the shell's exit status belongs to a filter or a fallback rather than the check. */
  readonly statusIsTheCheck: boolean;
}

/** Programs that print what they are given and change nothing a check would be about. */
const inspectionPrograms: ReadonlySet<string> = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "pwd",
  "echo",
  "printf",
  "tree",
  "file",
  "stat",
  "sort",
  "uniq",
  "cut",
  "diff",
  "which",
  "true",
  "jq",
  "awk",
  "sed",
  "nl",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "du",
  "tr",
]);

/** Read-only git subcommands, by their first word. */
const inspectingGit: ReadonlySet<string> = new Set([
  "status",
  "diff",
  "log",
  "show",
  "grep",
  "ls-files",
  "blame",
  "rev-parse",
  "branch",
]);

function isChangeOfDirectory(stage: ShellStage): boolean {
  return basename(stage.executable) === "cd";
}

function inspects(stage: ShellStage): boolean {
  const program = basename(stage.executable);
  if (program === "git") return inspectingGit.has(stage.arguments[0] ?? "");
  return inspectionPrograms.has(program);
}

function spell(stage: ShellStage, first: boolean): string {
  const text = [stage.executable, ...stage.arguments].join(" ");
  return first || stage.after === null ? text : `${stage.after} ${text}`;
}

/**
 * The observation a command makes. A string the tokenizer cannot read is a check whose status is
 * unknown: nothing about it can be said, and calling it an inspection would hide a failure.
 */
export function classifyShellCommand(command: string): ShellObservation {
  const stages = readShellStages(command);
  if (stages === null) return { kind: "check", subject: command.trim(), statusIsTheCheck: false };
  const working = stages.filter((stage) => !isChangeOfDirectory(stage));
  const lastCheck = working.findLastIndex((stage) => !inspects(stage));
  if (lastCheck === -1)
    return {
      kind: "inspection",
      subject: working.map((stage, index) => spell(stage, index === 0)).join(" "),
      statusIsTheCheck: false,
    };
  // After the last check, only `&&` keeps its status: a pipe reports the filter's, `||` turns a
  // failure into the fallback's success, and `;` reports whatever ran last.
  const after = working.slice(lastCheck + 1);
  const statusIsTheCheck = after.every((stage) => stage.after === "&&");
  const kept = working.slice(0, lastCheck + 1);
  return {
    kind: "check",
    subject: kept.map((stage, index) => spell(stage, index === 0)).join(" "),
    statusIsTheCheck,
  };
}
