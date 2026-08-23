import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { LoopEvent } from "../core/loop-events.ts";
import { describeLoopEvent } from "./plain-lines.ts";

/**
 * One event of every kind, in an order a real run produces, including the two the plain
 * stream drops. Frozen here so the interactive work cannot change what CI reads.
 */
const events: readonly LoopEvent[] = [
  { type: "plan", text: "read the failing test, then fix the parser" },
  { type: "plan", text: "" },
  { type: "model-call", step: 1, modelId: "local:qwen3-coder:30b-a3b" },
  { type: "tool-call", callId: "c1", toolName: "read", input: { path: "src/parse.ts" } },
  {
    type: "tool-outcome",
    callId: "c1",
    toolName: "read",
    failed: false,
    output: "export function parse() {}",
  },
  { type: "tool-call", callId: "c2", toolName: "shell", input: { command: "npm test", cwd: "." } },
  {
    type: "tool-outcome",
    callId: "c2",
    toolName: "shell",
    failed: true,
    output: "1 failing\nAssertionError: expected 2 to be 3",
  },
  { type: "model-error", step: 2, message: "the provider returned 429", willRetry: true },
  { type: "claim", text: "the parser now handles the empty case", verified: false },
  {
    type: "gate",
    gateId: "tests",
    status: "failed",
    blocking: true,
    detail: "12 collected, 1 failed",
    record: "sha256:aaa",
  },
  { type: "attempt", attempt: 1, cap: 3 },
  {
    type: "ratchet",
    attempt: 1,
    accepted: false,
    detail: "tests collected fell from 12 to 11",
    record: "sha256:bbb",
  },
  {
    type: "gate",
    gateId: "lint",
    status: "passed",
    blocking: false,
    detail: "no findings",
    record: "sha256:ccc",
  },
  {
    type: "gate",
    gateId: "coverage",
    status: "not-applicable",
    blocking: true,
    detail: "no report was written",
    record: "sha256:ddd",
  },
  { type: "escalated", gateId: "tests", detail: "the same failure three times", attempts: 3 },
  { type: "stopped", reason: "completed", steps: 7, tokensUsed: 4211 },
];

describe("the plain-line stream", () => {
  // The guarantee is byte-level: CI and every pipe read this, and an interactive feature that
  // changed it would change what a log file says without anyone reading a diff of it.
  it("is byte-identical to the committed fixture", async () => {
    const rendered = events
      .map(describeLoopEvent)
      .filter((line) => line !== null)
      .join("\n");
    const fixture = await readFile(new URL("./fixtures/plain-lines.txt", import.meta.url), "utf8");

    expect(`${rendered}\n`).toBe(fixture);
  });

  it("drops the events that carry nothing new on a plain stream", () => {
    expect(describeLoopEvent({ type: "plan", text: "" })).toBeNull();
  });
});
