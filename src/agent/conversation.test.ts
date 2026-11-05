import { describe, expect, it } from "vitest";
import {
  briefBlock,
  createConversation,
  recordBlock,
  stateBlock,
  taskBlock,
  windowTurns,
} from "./conversation.ts";
import { commandExchange } from "./exchange.ts";
import { initialRecord } from "./requirement-record.ts";

const quiet = { status: "", diff: "", findings: null, notice: null };

const exchange = (step: number, output: string) =>
  commandExchange({
    reply: `\`\`\`bash\ncat f${step}\n\`\`\``,
    result: `exit code: 0\n${output}`,
    fact: {
      step,
      command: `cat f${step}`,
      decision: "allowed",
      exitCode: 0,
      evidence: `${step}`.padStart(16, "c"),
      output: `.swarm/outputs/${step}.txt`,
      files: [],
      why: null,
    },
    output,
  });

describe("the state a turn ends with", () => {
  it("carries the status, the diff and the last failure verbatim", () => {
    const text = stateBlock({
      status: " M src/clamp.mjs\n",
      diff: "diff --git a/src/clamp.mjs b/src/clamp.mjs\n-old\n+new",
      findings: "check test failed",
      notice: "3 turns remain of 15.",
    });
    expect(text).toContain(" M src/clamp.mjs");
    expect(text).toContain("Diff against the base:\ndiff --git a/src/clamp.mjs b/src/clamp.mjs");
    expect(text).toContain("Latest verifier findings:\ncheck test failed");
    expect(text.endsWith("3 turns remain of 15.")).toBe(true);
  });

  it("says a clean tree is clean and an unchanged one unchanged", () => {
    expect(stateBlock(quiet)).toContain("(clean)");
    expect(stateBlock(quiet)).toContain("(no change yet)");
    expect(stateBlock(quiet)).not.toContain("Latest verifier findings");
  });

  it("shortens a long diff file by file, from the middle of each", () => {
    const diff = `diff --git a/x b/x\n${"+a\n".repeat(5000)}`;
    expect(stateBlock({ ...quiet, diff })).toContain("lines of x's change omitted");
  });
});

describe("the conversation a turn sends", () => {
  it("opens with the task alone, and ends with the record, the task's own text standing for R1's", () => {
    expect(taskBlock("Fix clamp.")).toBe("Task:\nFix clamp.");
    const record = recordBlock(initialRecord("Fix clamp."));
    expect(record).toContain('"id":"R1","text":"(the task above)"');
    expect(record).not.toContain("Fix clamp.");
    expect(stateBlock(quiet, initialRecord("Fix clamp."))).toMatch(/^Requirements as recorded/);
  });

  // A runtime's prompt cache holds a prefix only while its bytes repeat. The window used to move
  // one turn at a time, rewriting the turn that left it, so nothing after it was ever cached.
  it("moves the window a block at a time, so the turns before it repeat byte for byte", () => {
    const conversation = createConversation({ system: "s", task: "t", opening: "Begin." });
    const output = `${"start\n"}${"middle\n".repeat(400)}end`;
    const sent: string[][] = [];
    for (let step = 1; step <= windowTurns + 2 * briefBlock; step += 1) {
      conversation.add(exchange(step, output));
      sent.push(conversation.messages(initialRecord("t"), quiet).map((one) => one.content));
    }
    // Between two moves of the window, every message but the last is the same as the turn before.
    // sent[n - 1] holds n turns; the window stands still from windowTurns to that plus a block.
    const first = windowTurns - 1;
    const between = sent.slice(first, first + briefBlock - 1);
    expect(between).toHaveLength(briefBlock - 1);
    for (const [at, turn] of between.entries()) {
      const next = sent[first + at + 1] ?? [];
      expect(next.slice(0, turn.length - 1)).toEqual(turn.slice(0, -1));
    }
  });

  it("sends the latest turns whole and the older ones as excerpts, with the state only at the end", () => {
    const conversation = createConversation({ system: "s", task: "t", opening: "Begin." });
    const output = `${"start\n"}${"middle\n".repeat(400)}end`;
    const turns = windowTurns + briefBlock;
    for (let step = 1; step <= turns; step += 1) conversation.add(exchange(step, output));
    const sent = conversation.messages(initialRecord("t"), { ...quiet, findings: "R1 failed" });
    expect(sent.map((one) => one.role)).toEqual([
      "system",
      "user",
      ...Array.from({ length: turns }, () => ["assistant", "user"]).flat(),
    ]);
    const results = sent.filter((one, at) => one.role === "user" && at > 1);
    expect(results[0]?.content).toContain("lines omitted");
    expect(results[0]?.content).toContain(
      "[evidence ccccccccccccccc1; whole output: .swarm/outputs/1.txt]",
    );
    expect(
      results.slice(briefBlock).every((one) => one.content.includes("middle\n".repeat(400))),
    ).toBe(true);
    expect(sent.filter((one) => one.content.includes("Latest verifier findings"))).toEqual([
      sent.at(-1),
    ]);
  });

  it("compacts nothing while the prompt stays under the threshold", () => {
    const conversation = createConversation({ system: "s", task: "t", opening: "Begin." });
    for (let step = 1; step <= 20; step += 1) conversation.add(exchange(step, "short"));
    const relieved = conversation.relieve({
      record: initialRecord("t"),
      state: quiet,
      calibration: 1,
      contextTokens: 32_768,
      unresolved: [],
      verification: null,
    });
    expect(relieved).toBeNull();
  });

  it("measures pressure with the runtime's count, compacting where the estimate alone would not", () => {
    const relieve = (calibration: number) => {
      const conversation = createConversation({ system: "s", task: "t", opening: "Begin." });
      for (let step = 1; step <= 8; step += 1) conversation.add(exchange(step, "x".repeat(2000)));
      return conversation.relieve({
        record: initialRecord("t"),
        state: quiet,
        calibration,
        contextTokens: 8_000,
        unresolved: [],
        verification: null,
      });
    };
    expect(relieve(1)).toBeNull();
    expect(relieve(2)).toMatchObject({ before: expect.any(Number), after: expect.any(Number) });
  });
});
