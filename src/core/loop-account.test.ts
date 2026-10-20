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

describe("the recent shell results the account carries", () => {
  const printed = (callId: string, command: string, output: string, n = 7) =>
    exchange(callId, "shell", { command }, output, false).map((message) =>
      message.role === "tool"
        ? {
            ...message,
            outcomes: message.outcomes.map((one) => ({
              ...one,
              output: `${output}${trailer(n)}`,
            })),
          }
        : message,
    );

  it("keeps the last three that printed and exited 0, in order, with command, status, excerpt and record", () => {
    // The first repair attempt of run 20261020T045117-41e2cc: probes of the class against the
    // input, each printing null and exiting 0, which the account used to drop entirely.
    const messages: ConversationMessage[] = [
      { role: "user", text: "fix the regex" },
      ...printed(
        "a",
        "node -e \"console.log(/^[fF]/.exec('ftp'))\"",
        "exit code: 0\nstdout:\n[ 'f' ]",
        1,
      ),
      ...printed(
        "b",
        "node -e \"require('./lib/marked.cjs')\"",
        "exit code: 1\nstdout:\nError: Cannot find module",
        2,
      ),
      ...printed("c", 'node -e "process.exit(0)"', "exit code: 0", 3),
      ...printed(
        "d",
        "node -e \"console.log(/^[fF][pP]/.exec('ftp'))\"",
        "exit code: 0\nstdout:\nnull",
        4,
      ),
      ...printed(
        "e",
        "node -e \"console.log(/^[fF][pP][tT]/.exec('ftp'))\"",
        "exit code: 0\nstdout:\nnull",
        5,
      ),
      ...printed(
        "f",
        "node -e \"console.log(/^[fF][pP]/.test('ftp'))\"",
        "exit code: 0\nstdout:\nfalse",
        6,
      ),
    ];
    const account = priorLoopAccount(messages, "max-steps", 6);
    expect(account.recentShell.map((one) => one.call)).toEqual([
      "node -e \"console.log(/^[fF][pP]/.exec('ftp'))\"",
      "node -e \"console.log(/^[fF][pP][tT]/.exec('ftp'))\"",
      "node -e \"console.log(/^[fF][pP]/.test('ftp'))\"",
    ]);
    expect(account.recentShell[0]).toEqual({
      call: "node -e \"console.log(/^[fF][pP]/.exec('ftp'))\"",
      exitCode: 0,
      output: "stdout:\nnull",
      record: `sha256:${(4).toString(16).padStart(64, "0")}`,
      beforeLaterEdits: [],
    });
    // The failed one and the one that printed nothing stay where they were: in the empty list.
    expect(account.emptyShell.map((one) => one.call)).toEqual([
      "node -e \"require('./lib/marked.cjs')\"",
      'node -e "process.exit(0)"',
    ]);
    const text = describePriorLoop(account);
    expect(text).toContain("the last 3 shell command(s) that printed something and exited 0");
    expect(text).toContain("historical observations of that loop's files at the time");
    expect(text).toContain("not that what it examined was correct");
    expect(text).toContain(
      `  1. node -e "console.log(/^[fF][pP]/.exec('ftp'))" (exit 0; on the files as that loop left them; record sha256:${(4).toString(16).padStart(64, "0")}) printed:\n     stdout:\n     null`,
    );
    expect(text).not.toContain("[ 'f' ]");
  });

  it("names the loop's later edits, so a result is read as predating them, and bounds what it printed", () => {
    const long = Array.from(
      { length: 12 },
      (_, index) => `line ${index + 1} ${"x".repeat(60)}`,
    ).join("\n");
    const messages: ConversationMessage[] = [
      ...printed("a", "npm test", `exit code: 0\nstdout:\n${long}`, 1),
      ...exchange(
        "w",
        "edit",
        { path: "src/rules.ts", find: "a", replace: "b" },
        "replaced 1 occurrence(s) in src/rules.ts",
      ),
      ...exchange(
        "x",
        "edit",
        { path: "src/other.ts", find: "a", replace: "b" },
        "no occurrence of the search text in src/other.ts",
        true,
      ),
      ...printed("b", "npm run build", "exit code: 0\nstdout:\nbuilt", 2),
    ];
    const account = priorLoopAccount(messages, "completed", 4);
    expect(account.recentShell.map((one) => one.beforeLaterEdits)).toEqual([["src/rules.ts"], []]);
    const first = account.recentShell[0]?.output ?? "";
    expect(first.split("\n").length).toBeLessThanOrEqual(9);
    expect(first.length).toBeLessThanOrEqual(484);
    expect(first.endsWith("...")).toBe(true);
    const text = describePriorLoop(account);
    expect(text).toContain("(exit 0; before that loop's later edit of src/rules.ts;");
    expect(text).toContain("npm run build (exit 0; on the files as that loop left them;");
  });

  it("reads the status of a bounded output view, and says nothing when no result qualifies", () => {
    const view =
      "[output view: the full output is 25,049 characters in 53 lines, kept on evidence record sha256:" +
      `${"a".repeat(64)} (kind tool-call:shell); lines 14 to 49 omitted. recorded status: exit code 0, not timed out.]` +
      "\nexit code: 0\nstdout:\n> marked test\n[... lines 14 to 49 omitted ...]\n1713 passing";
    const account = priorLoopAccount([...printed("v", "npm test", view, 9)], "completed", 1);
    expect(account.recentShell).toHaveLength(1);
    expect(account.recentShell[0]?.output).toBe(
      "stdout:\n> marked test\n[... lines 14 to 49 omitted ...]\n1713 passing",
    );
    // The shared transcript's `echo rc=$?` printed and exited 0, so it qualifies; a loop whose
    // shell calls all failed or printed nothing carries no such line.
    expect(describePriorLoop(priorLoopAccount(transcript, "stalled", 9))).toContain(
      '1. grep -rn "emitWsNeeded" lib/; echo rc=$? (exit 0;',
    );
    const silent: ConversationMessage[] = [
      ...exchange("s", "shell", { command: "grep -rn x lib/" }, "exit code: 1"),
    ];
    expect(describePriorLoop(priorLoopAccount(silent, "stalled", 1))).not.toContain(
      "printed something and exited 0",
    );
  });
});
