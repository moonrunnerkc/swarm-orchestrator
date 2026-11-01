import { truncate } from "./prompt.ts";

/** Bytes of an old output kept in the prompt once its turn leaves the working window. */
export const excerptBytes = 400;

/** Bytes of an old reply kept in the prompt once its turn leaves the working window. */
const briefBytes = 300;

/** A ledger payload digest by its first 16 hex digits: enough to find it, short to repeat. */
export const evidenceRef = (digest: string) => digest.replace(/^sha256:/, "").slice(0, 16);

const firstLine = (text: string) => text.split("\n")[0] ?? "";
const bash = (command: string) => `\`\`\`bash\n${command}\n\`\`\``;

/**
 * The start and the end of an output in whole lines, a half of the bytes each, and how many
 * lines went between. Output with no line short enough is cut by bytes instead.
 */
export function excerptOf(output: string, bytes: number = excerptBytes): string {
  if (Buffer.byteLength(output) <= bytes) return output;
  const lines = output.split("\n");
  const take = (from: readonly string[]) => {
    const kept: string[] = [];
    let used = 0;
    for (const line of from) {
      used += Buffer.byteLength(line) + 1;
      if (used > bytes / 2) break;
      kept.push(line);
    }
    return kept;
  };
  const head = take(lines);
  const tail = take(lines.slice(head.length).reverse()).reverse();
  if (head.length + tail.length === 0) return truncate(output, bytes);
  const omitted = lines.length - head.length - tail.length;
  return [...head, `[... ${omitted} lines omitted ...]`, ...tail].join("\n");
}

/** One command the loop ran, as the compaction digest states it once its turn is folded. */
export interface CommandFact {
  readonly step: number;
  readonly command: string;
  readonly decision: "allowed" | "denied" | "failed";
  readonly exitCode: number | null;
  /** The ledger record that holds the command and its whole output. */
  readonly evidence: string;
  /** The workspace copy of the whole output, where an excerpt cannot hold all of it. */
  readonly output: string | null;
  /** Files the command named that exist in the workspace. */
  readonly files: readonly string[];
  /** For a command that did not succeed, its last line of output: why, as far as one line says. */
  readonly why: string | null;
}

/**
 * One turn: the model's reply and the harness's answer, each in full for the working window
 * and bounded for older turns, and the line the compaction digest keeps of it.
 */
export interface Exchange {
  readonly step: number;
  readonly reply: string;
  readonly brief: string;
  readonly result: string;
  readonly summary: string;
  readonly fact: string;
  readonly command: CommandFact | null;
  /** Files whose change against the base moved after this turn. */
  readonly edited: readonly string[];
}

export const succeeded = (fact: CommandFact) => fact.decision === "allowed" && fact.exitCode === 0;

/** How a command ended, in the words its turn used. */
const endingOf = (fact: CommandFact) =>
  fact.decision === "allowed" ? `exit code: ${fact.exitCode}` : fact.decision;

/** A command's turn: an old one keeps the command's start and its output's start and end. */
export function commandExchange(input: {
  readonly reply: string;
  readonly result: string;
  readonly fact: CommandFact;
  readonly output: string;
}): Exchange {
  const { fact } = input;
  const lines = fact.command.split("\n");
  const command =
    Buffer.byteLength(fact.command) <= briefBytes
      ? fact.command
      : `${truncate(lines.slice(0, 3).join("\n"), briefBytes)}\n# [${lines.length} lines; not repeated here]`;
  const where = fact.output === null ? "" : `; whole output: ${fact.output}`;
  return {
    step: fact.step,
    reply: input.reply,
    brief: Buffer.byteLength(input.reply) <= briefBytes ? input.reply : bash(command),
    result: input.result,
    summary: `${endingOf(fact)}\n${excerptOf(input.output)}\n[evidence ${fact.evidence}${where}]`,
    fact: `\`${firstLine(fact.command)}\` ${fact.decision === "allowed" ? `exited ${fact.exitCode}` : `was ${fact.decision}`} [evidence ${fact.evidence}${where}]`,
    command: fact,
    edited: [],
  };
}

/** Any other turn: a requirements block, a completion, or a reply that was not used. */
export function noteExchange(input: {
  readonly step: number;
  readonly reply: string;
  readonly brief: string;
  readonly result: string;
  readonly fact: string;
}): Exchange {
  return {
    step: input.step,
    reply: input.reply,
    brief: Buffer.byteLength(input.reply) <= briefBytes ? input.reply : input.brief,
    result: input.result,
    summary: excerptOf(input.result),
    fact: input.fact,
    command: null,
    edited: [],
  };
}
