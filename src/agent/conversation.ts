import {
  compactionTarget,
  compactionThreshold,
  digestOf,
  estimateTokens,
  measuredTokens,
} from "./context.ts";
import { diffView } from "./diff-view.ts";
import type { Exchange } from "./exchange.ts";
import type { Message } from "./model.ts";
import { truncate } from "./prompt.ts";
import type { RequirementRecord } from "./requirement-record.ts";

/** Turns kept in full at the end of the conversation; older ones are bounded excerpts. */
export const windowTurns = 4;

/**
 * Turns shortened at once when the window moves: the conversation before the window is then the
 * same bytes for this many turns, so a runtime's prompt cache holds it, instead of every turn
 * rewriting the turn that just left the window.
 */
export const briefBlock = 4;

/** Bytes of the current diff a turn carries; each file's change is shortened to fit (diff-view.ts). */
export const diffCap = 6_000;

/** What the last message of every turn carries, read fresh, never accumulated copies. */
export interface CurrentState {
  /** `git status --short` of the working tree. */
  readonly status: string;
  /** The working tree's change against the base. */
  readonly diff: string;
  /** The latest verifier findings, or null before the first verification. */
  readonly findings: string | null;
  /** What the harness's checks found after the last change, or null before any change. */
  readonly checks?: string | null;
  /** A notice said once, such as the turns or time running short. */
  readonly notice: string | null;
}

/** The stable front of the conversation: the task, byte for byte the same every turn. */
export function taskBlock(task: string): string {
  return ["Task:", task].join("\n");
}

/** The record as the model last set it, read at the end of every turn rather than the front. */
export function recordBlock(record: RequirementRecord): string {
  const requirements = record.requirements.map((one) =>
    JSON.stringify(one.id === "R1" ? { ...one, text: "(the task above)" } : one),
  );
  return [
    "Requirements as recorded (a requirements block replaces them; R1 is the task above):",
    `[\n${requirements.join(",\n")}\n]`,
  ].join("\n");
}

/** The tree as it stands and what the verifier last said of it, for the end of the prompt. */
export function stateBlock(state: CurrentState, record?: RequirementRecord): string {
  return [
    ...(record === undefined ? [] : [recordBlock(record), ""]),
    "The working tree now.",
    "git status --short:",
    state.status.trim().length === 0 ? "(clean)" : state.status.trimEnd(),
    "",
    "Diff against the base:",
    state.diff.trim().length === 0 ? "(no change yet)" : diffView(state.diff.trimEnd(), diffCap),
    ...(state.checks == null ? [] : ["", state.checks]),
    ...(state.findings === null ? [] : ["", "Latest verifier findings:", truncate(state.findings)]),
    ...(state.notice === null ? [] : ["", state.notice]),
  ].join("\n");
}

export interface Conversation {
  add(exchange: Exchange): void;
  /** Credits files whose change moved since the last turn to that turn. */
  edited(files: readonly string[]): void;
  messages(record: RequirementRecord, state: CurrentState): Message[];
  /**
   * Folds the oldest turns into a digest once the measured prompt passes the threshold of the
   * context, until it is back under the target or one turn is left. Returns the measures before
   * and after, or null where nothing was folded.
   */
  relieve(input: {
    readonly record: RequirementRecord;
    readonly state: CurrentState;
    readonly calibration: number;
    readonly contextTokens: number;
    readonly unresolved: readonly string[];
    readonly verification: string | null;
  }): { readonly before: number; readonly after: number } | null;
}

/**
 * The prompt a turn sends: system and repository instructions, then the task and the record,
 * byte for byte the same from turn to turn until the record changes; then the turns, the latest
 * in full and older ones as bounded excerpts naming their evidence; then the current state.
 */
export function createConversation(input: {
  readonly system: string;
  readonly task: string;
  /** What the model reads first: "Begin.", or what another model left it. */
  readonly opening: string;
}): Conversation {
  const exchanges: Exchange[] = [];
  let folded = 0;
  let digest: string | null = null;

  const messages = (record: RequirementRecord, state: CurrentState): Message[] => {
    const now = stateBlock(state, record);
    const kept = exchanges.slice(folded);
    const first = [taskBlock(input.task), input.opening, digest]
      .filter((part) => part !== null)
      .join("\n\n");
    const rendered: Message[] = [
      { role: "system", content: input.system },
      { role: "user", content: first },
      // Before any turn the state stands alone, so the task's message never changes after it.
      ...(kept.length === 0 ? [{ role: "user" as const, content: now }] : []),
    ];
    // The window moves a block at a time: from windowTurns to windowTurns + briefBlock - 1 whole.
    const cut = Math.max(0, Math.floor((kept.length - windowTurns) / briefBlock) * briefBlock);
    kept.forEach((one, at) => {
      const full = at >= cut;
      const result = full ? one.result : one.summary;
      rendered.push({ role: "assistant", content: full ? one.reply : one.brief });
      rendered.push({
        role: "user",
        content: at === kept.length - 1 ? `${result}\n\n${now}` : result,
      });
    });
    return rendered;
  };

  return {
    add(exchange) {
      exchanges.push(exchange);
    },
    edited(files) {
      const last = exchanges.at(-1);
      if (last === undefined || files.length === 0) return;
      exchanges[exchanges.length - 1] = { ...last, edited: [...last.edited, ...files] };
    },
    messages,
    relieve(pressure) {
      const measure = () =>
        measuredTokens(
          estimateTokens(
            messages(pressure.record, pressure.state)
              .map((one) => one.content)
              .join(""),
          ),
          pressure.calibration,
        );
      const before = measure();
      if (before <= pressure.contextTokens * compactionThreshold) return null;
      const start = folded;
      while (
        exchanges.length - folded > 1 &&
        measure() > pressure.contextTokens * compactionTarget
      ) {
        folded += 1;
        digest = digestOf({
          folded: exchanges.slice(0, folded),
          measured: before,
          contextTokens: pressure.contextTokens,
          unresolved: pressure.unresolved,
          verification: pressure.verification,
        });
      }
      return folded === start ? null : { before, after: measure() };
    },
  };
}
