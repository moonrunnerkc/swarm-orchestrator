import { createHash } from "node:crypto";
import type { LoopEvent } from "../core/loop-events.ts";
import { pathsInPatch } from "../gates/patch-paths.ts";

/**
 * Reading what another agent did.
 *
 * The product's job is verification, so what it verifies must not have to be its own agent. Two
 * adapters ship, because one is an interface and two is a contract: a stream some other tool
 * already emits, and a plain shape for anything that emits nothing.
 *
 * Nothing is dropped silently. A line an adapter does not recognize is refused by line number,
 * because a dropped line is evidence that quietly was not read, which is the failure this whole
 * system exists to prevent.
 */
export class MalformedAdapterInputError extends Error {
  constructor(line: number, problem: string) {
    super(
      `line ${line} of the agent stream could not be read: ${problem}. Nothing is skipped: a ` +
        "line this build does not recognize is a line whose evidence would go unread.",
    );
    this.name = "MalformedAdapterInputError";
  }
}

const knownGenericTypes = new Set([
  "plan",
  "model-call",
  "model-text",
  "model-error",
  "tool-call",
  "tool-outcome",
  "claim",
  "stopped",
]);

/** The plain shape: this build's own event names, one JSON object per line. */
export function eventsFromGenericJsonl(text: string): readonly LoopEvent[] {
  const events: LoopEvent[] = [];
  let lineNumber = 0;
  for (const line of text.split("\n")) {
    lineNumber += 1;
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      throw new MalformedAdapterInputError(
        lineNumber,
        cause instanceof Error ? cause.message : "it is not JSON",
      );
    }
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== "string" || !knownGenericTypes.has(type)) {
      throw new MalformedAdapterInputError(
        lineNumber,
        `"${String(type)}" is not an event kind this build has`,
      );
    }
    events.push(parsed as LoopEvent);
  }
  return events;
}

interface ClaudeContentBlock {
  readonly type?: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly tool_use_id?: string;
  readonly content?: unknown;
  readonly is_error?: boolean;
}

/**
 * Claude Code's `--output-format stream-json`, mapped onto this build's names. A second real
 * shape rather than a second imagined one, so the adapter interface is answering to something.
 */
export function eventsFromClaudeCodeStream(text: string): readonly LoopEvent[] {
  const events: LoopEvent[] = [];
  let lineNumber = 0;
  let step = 0;

  for (const line of text.split("\n")) {
    lineNumber += 1;
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: { type?: string; message?: { content?: ClaudeContentBlock[] }; num_turns?: number };
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      throw new MalformedAdapterInputError(
        lineNumber,
        cause instanceof Error ? cause.message : "it is not JSON",
      );
    }

    switch (parsed.type) {
      case "system":
        // The session preamble carries no work. Recognized rather than ignored.
        continue;
      case "assistant": {
        step += 1;
        for (const block of parsed.message?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string") {
            events.push({ type: "model-text", step, text: block.text });
          } else if (block.type === "tool_use") {
            events.push({
              type: "tool-call",
              callId: String(block.id ?? ""),
              toolName: String(block.name ?? ""),
              input: block.input,
            });
          }
        }
        continue;
      }
      case "user": {
        for (const block of parsed.message?.content ?? []) {
          if (block.type === "tool_result") {
            events.push({
              type: "tool-outcome",
              callId: String(block.tool_use_id ?? ""),
              toolName: "",
              failed: block.is_error === true,
              output:
                typeof block.content === "string" ? block.content : JSON.stringify(block.content),
            });
          }
        }
        continue;
      }
      case "result":
        events.push({
          type: "stopped",
          reason: "completed",
          steps: Number(parsed.num_turns ?? step),
          tokensUsed: 0,
        });
        continue;
      default:
        throw new MalformedAdapterInputError(
          lineNumber,
          `"${String(parsed.type)}" is not a Claude Code stream kind this build maps`,
        );
    }
  }
  return events;
}

export interface AdaptedPatch {
  readonly patch: string;
  readonly paths: readonly string[];
  readonly digest: string;
}

/**
 * A patch on its own, for an agent that emits no stream at all. This is the minimum an external
 * producer has to hand over for `swarm ci` to say anything about it.
 */
export function patchFromWorkspaceDiff(patch: string): AdaptedPatch {
  const paths = pathsInPatch(patch);
  if (paths.length === 0) {
    throw new Error(
      "this diff names no file, so it is not a patch anything can be verified against. A " +
        "unified diff carries `diff --git a/<path> b/<path>` headers; produce one with " +
        "`git diff`.",
    );
  }
  return {
    patch,
    paths,
    digest: `sha256:${createHash("sha256").update(patch, "utf8").digest("hex")}`,
  };
}
