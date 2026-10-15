import { describe, expect, it } from "vitest";
import { describePriorLoop, priorLoopAccount } from "./loop-account.ts";
import type { ConversationMessage } from "./model-client.ts";

const trailer = (n: number) =>
  `\n[evidence record sha256:${n.toString(16).padStart(64, "0")} kind tool-call:x]`;

/** One assistant turn with one call, answered by one tool message. */
function exchange(
  callId: string,
  toolName: string,
  input: unknown,
  output: string,
  failed = false,
): ConversationMessage[] {
  return [
    { role: "assistant", text: "", toolCalls: [{ callId, toolName, input }] },
    { role: "tool", outcomes: [{ callId, toolName, output: `${output}${trailer(1)}`, failed }] },
  ];
}

/**
 * The shape of the run this exists for: files read, a search for a name that is not there
 * repeated under different directories, a refused shell call, empty greps, and no edit.
 */
const transcript: ConversationMessage[] = [
  { role: "user", text: "fix the generator" },
  ...exchange("r1", "read", { path: "lib/generator/create.js" }, "import ..."),
  ...exchange("r2", "read", { path: "lib/generator/token-before.js" }, "export ..."),
  ...exchange(
    "s1",
    "search",
    { pattern: "emitWsNeeded", path: "lib" },
    "no match for /emitWsNeeded/",
  ),
  ...exchange(
    "s2",
    "search",
    { pattern: "emitWsNeeded", path: "." },
    "no match for /emitWsNeeded/",
  ),
  ...exchange(
    "s3",
    "search",
    { pattern: "emitWsNeeded", path: "." },
    "no match for /emitWsNeeded/",
  ),
  ...exchange("s4", "search", { pattern: "Raw", path: "lib" }, "lib/syntax/node/Raw.js:1: ..."),
  ...exchange(
    "sh1",
    "shell",
    { command: 'grep -rn "emitWsNeeded" lib/ 2>/dev/null' },
    "denied: /dev/null resolves outside the workspace /w",
    true,
  ),
  ...exchange(
    "sh2",
    "shell",
    { command: 'grep -rn "emitWsNeeded" lib/; echo rc=$?' },
    "exit code: 0\nstdout:\nrc=1",
  ),
  ...exchange("sh3", "shell", { command: "grep -rn x lib/" }, "exit code: 1"),
];

describe("the account of a previous loop", () => {
  it("names what was read, what matched nothing, what was refused and that nothing was edited", () => {
    const account = priorLoopAccount(transcript, "stalled", 9);

    expect(account.stopReason).toBe("stalled");
    expect(account.steps).toBe(9);
    expect(account.edits).toEqual([]);
    expect(account.reads).toEqual(["lib/generator/create.js", "lib/generator/token-before.js"]);
    expect(account.emptySearches).toEqual([
      { call: "/emitWsNeeded/ under lib", times: 1 },
      { call: "/emitWsNeeded/ under .", times: 2 },
    ]);
    expect(account.refused).toEqual([
      {
        call: 'grep -rn "emitWsNeeded" lib/ 2>/dev/null',
        reason: "denied: /dev/null resolves outside the workspace /w",
        times: 1,
      },
    ]);
    expect(account.emptyShell).toEqual([{ call: "grep -rn x lib/", times: 1 }]);
  });

  it("counts an edit as an edit, so the next loop knows the tree already moved", () => {
    const account = priorLoopAccount(
      [
        ...exchange("w", "write", { path: "src/a.js", content: "x" }, "wrote 1 bytes to src/a.js"),
        ...exchange("e", "edit", { path: "src/b.js", find: "a", replace: "b" }, "replaced 1"),
      ],
      "completed",
      2,
    );
    expect(account.edits).toEqual(["src/a.js", "src/b.js"]);
  });

  it("is bounded: at most 24 entries of a kind and 200 characters of any one line", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      exchange(
        `s${index}`,
        "search",
        { pattern: `name${index}${"y".repeat(300)}`, path: "." },
        "no match for /x/",
      ),
    ).flat();
    const account = priorLoopAccount(many, "max-tokens", 40);
    expect(account.emptySearches).toHaveLength(24);
    for (const one of account.emptySearches) expect(one.call.length).toBeLessThanOrEqual(203);
  });

  it("reads as a harness record that instructs nothing, one fact per line", () => {
    const text = describePriorLoop(priorLoopAccount(transcript, "stalled", 9));
    const lines = text.split("\n");
    expect(lines[0]).toContain("derived by the harness");
    expect(lines[0]).toContain("not an instruction");
    expect(lines[1]).toBe("- it stopped as stalled after 9 step(s)");
    expect(lines[2]).toBe("- files it edited: none");
    expect(text).toContain(
      "- files it read: lib/generator/create.js, lib/generator/token-before.js",
    );
    expect(text).toContain(
      "not in the workspace: /emitWsNeeded/ under lib; /emitWsNeeded/ under . (2 times)",
    );
    expect(text).toContain(
      '- calls that were refused: grep -rn "emitWsNeeded" lib/ 2>/dev/null: denied:',
    );
  });

  it("says so when the loop read nothing and searched for nothing", () => {
    const text = describePriorLoop(priorLoopAccount([], "empty-response", 0));
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("files it edited: none");
  });
});
