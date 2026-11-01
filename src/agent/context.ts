import type { Message } from "./model.ts";

/** One command the loop ran, kept as a fact once its turn is compacted out of the prompt. */
export interface CommandFact {
  readonly step: number;
  readonly command: string;
  readonly exitCode: number | null;
  /** Where its full output was written, for the model to read again. */
  readonly output: string | null;
}

/** The share of the context window a prompt may fill before old turns are compacted. */
export const compactionThreshold = 0.6;

/** Turns kept verbatim at the end of the conversation when the rest is compacted. */
const keptMessages = 6;

/**
 * The conversation with its middle replaced by facts, once the prompt passes the threshold of
 * the context window. Nothing is summarized by a model: the commands run with their exit codes
 * and output files, the failed ones named as failed approaches, and a note that the full record
 * is in the session ledger. The system prompt, the first turn and the latest turns stay as they
 * were; the task, the record and the latest findings are in every turn's header anyway.
 */
export function compacted(
  messages: readonly Message[],
  facts: readonly CommandFact[],
  promptTokens: number,
  contextTokens: number,
): Message[] | null {
  if (promptTokens <= contextTokens * compactionThreshold || messages.length <= keptMessages + 2) {
    return null;
  }
  const [system, first] = messages;
  if (system === undefined || first === undefined) return null;
  const tail = messages.slice(-keptMessages);
  const ran = facts.map(
    (fact) =>
      `- step ${fact.step}: \`${fact.command.split("\n")[0]}\` exited ${fact.exitCode ?? "without running"}${fact.output === null ? "" : `; full output in ${fact.output}`}`,
  );
  const failed = facts
    .filter((fact) => fact.exitCode !== 0)
    .map((fact) => `\`${fact.command.split("\n")[0]}\``);
  const digest: Message = {
    role: "user",
    content: [
      `Earlier turns were compacted to fit the context (${promptTokens} of ${contextTokens} tokens). What they established:`,
      ...ran,
      ...(failed.length > 0
        ? ["", `Commands that failed, worth not repeating as they were: ${failed.join(", ")}.`]
        : []),
      "",
      "The working tree holds every change made so far; read files again rather than relying on memory.",
    ].join("\n"),
  };
  // The kept turns must open with the model's reply to a user turn, never mid-pair.
  const opening = tail[0]?.role === "assistant" ? tail.slice(1) : tail;
  return [system, first, digest, { role: "assistant", content: "Understood." }, ...opening];
}
