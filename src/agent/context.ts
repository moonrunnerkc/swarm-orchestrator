import { type Exchange, succeeded } from "./exchange.ts";
import type { RequirementRecord } from "./requirement-record.ts";

/** The share of the context window a prompt may fill before old turns are compacted. */
export const compactionThreshold = 0.6;

/** The share compaction brings the prompt back under, so it does not compact again every turn. */
export const compactionTarget = 0.4;

/** A text's size in tokens, estimated at four characters each where the runtime gives no count. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * The prompt's size as measured: the estimate, scaled by how the runtime's last reported count
 * compared with its estimate of the same prompt. A runtime that reuses a cached prefix may count
 * only the tokens it evaluated, so a reported count never lowers the measure below the estimate.
 */
export const measuredTokens = (estimate: number, calibration: number) =>
  Math.ceil(estimate * Math.max(1, calibration));

/**
 * The requirements still open: those the latest findings do not call satisfied, or every one
 * before the first verification.
 */
export function unresolvedOf(record: RequirementRecord, findings: string | null): string[] {
  if (findings === null) return record.requirements.map((one) => `${one.id} not verified yet`);
  return findings
    .split("\n")
    .filter((line) => /^R\d+ /.test(line) && !/^R\d+ satisfied\b/.test(line));
}

const firstLine = (text: string) => text.split("\n")[0] ?? "";
const clip = (text: string, bytes: number) =>
  Buffer.byteLength(text) <= bytes ? text : `${Buffer.from(text).subarray(0, bytes).toString()}...`;

/** Each file and the steps that named or changed it, in the order first seen. */
function stepsByFile(pairs: readonly (readonly [string, number])[]): string {
  const steps = new Map<string, number[]>();
  for (const [file, step] of pairs) steps.set(file, [...(steps.get(file) ?? []), step]);
  return [...steps].map(([file, at]) => `${file} (${at.join(", ")})`).join(", ");
}

/**
 * What compacted turns established, without a model: every turn's fact with the ledger evidence
 * behind it, the files read and edited, the commands that failed and why, the commands run more
 * than once, and the requirements still open. The full record stays in the session ledger, and
 * a whole output stays readable in the workspace copy its line names.
 */
export function digestOf(input: {
  readonly folded: readonly Exchange[];
  readonly measured: number;
  readonly contextTokens: number;
  readonly unresolved: readonly string[];
  /** The ledger record of the verification the open requirements come from, if one ran. */
  readonly verification: string | null;
}): string {
  const { folded } = input;
  const commands = folded.flatMap((one) => (one.command === null ? [] : [one.command]));
  const read = stepsByFile(
    commands.flatMap((fact) => fact.files.map((file) => [file, fact.step] as const)),
  );
  const edited = stepsByFile(
    folded.flatMap((one) => one.edited.map((file) => [file, one.step] as const)),
  );
  const failed = commands
    .filter((fact) => !succeeded(fact))
    .map(
      (fact) =>
        `- step ${fact.step}: \`${firstLine(fact.command)}\` ${fact.decision === "allowed" ? `exited ${fact.exitCode}` : `was ${fact.decision}`}${fact.why === null ? "" : `: ${clip(fact.why, 160)}`} [evidence ${fact.evidence}]`,
    );
  const runs = new Map<string, number>();
  for (const fact of commands) runs.set(fact.command, (runs.get(fact.command) ?? 0) + 1);
  const repeated = [...runs]
    .filter(([, count]) => count > 1)
    .map(([command, count]) => `\`${firstLine(command)}\` (${count} times)`);
  const source =
    input.verification === null ? "" : ` at the last verification [evidence ${input.verification}]`;
  return [
    `Turns ${folded[0]?.step ?? 0} to ${folded.at(-1)?.step ?? 0} were compacted to fit the context (${input.measured} of ${input.contextTokens} tokens). What they established, each with the ledger evidence behind it:`,
    ...folded.map((one) => `- step ${one.step}: ${one.fact}`),
    ...(read.length > 0 ? ["", `Files read or named, by step: ${read}.`] : []),
    ...(edited.length > 0
      ? ["", `Files edited, by the step after which they changed: ${edited}.`]
      : []),
    ...(failed.length > 0
      ? ["", "Failed approaches, worth not repeating as they were:", ...failed]
      : []),
    ...(repeated.length > 0 ? ["", `Ran more than once: ${repeated.join(", ")}.`] : []),
    ...(input.unresolved.length > 0
      ? [
          "",
          `Unresolved requirements${source}:`,
          ...input.unresolved.map((line) => `- ${clip(line, 200)}`),
        ]
      : []),
    "",
    "The working tree holds every change made so far. Whole files read again will be compacted",
    "away again. Read only the lines you need (grep -n, sed -n 'a,bp'), and make the change.",
  ].join("\n");
}

/** Each file's section of a diff by its path, so the next turn's diff shows which files moved. */
export function diffSections(diff: string): Map<string, string> {
  const sections = new Map<string, string>();
  let path: string | null = null;
  let lines: string[] = [];
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (header !== null) {
      if (path !== null) sections.set(path, lines.join("\n"));
      path = header[1] ?? null;
      lines = [];
    }
    lines.push(line);
  }
  if (path !== null) sections.set(path, lines.join("\n"));
  return sections;
}

/** The files whose change against the base differs between two diffs, in either direction. */
export function movedFiles(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (path) => before.get(path) !== after.get(path),
  );
}
