import { describe, expect, it } from "vitest";
import {
  createStallTracker,
  repeatedAnswerNotice,
  stallNotice,
  stallNoticePrefix,
} from "./tool-stall.ts";

const trailer = (n: number) =>
  `\n[evidence record sha256:${n.toString(16).padStart(64, "0")} kind tool-call:shell]`;

function inspection(n: number, output = "exit code: 0\nstdout:\n3.0.3") {
  return {
    toolName: "shell",
    input: { command: "node -e \"console.log(require('./package.json').version)\"" },
    failed: false,
    output: `${output}${trailer(n)}`,
  };
}

describe("the stall tracker", () => {
  it("calls the fourth identical inspection a stall, trailer digests notwithstanding", () => {
    const tracker = createStallTracker();
    expect(tracker.observe(inspection(1))).toBeNull();
    expect(tracker.observe(inspection(2))).toBeNull();
    expect(tracker.observe(inspection(3))).toBeNull();
    expect(tracker.observe(inspection(4))).toMatchObject({ toolName: "shell", repeats: 3 });
  });

  it("treats a poll whose answer changes as progress", () => {
    const tracker = createStallTracker();
    for (let n = 1; n <= 12; n += 1)
      expect(tracker.observe(inspection(n, `exit code: 0\nstdout:\nline ${n}`))).toBeNull();
  });

  it("treats a changed exit status as a new answer, and alternating the two as a stall", () => {
    const tracker = createStallTracker();
    expect(tracker.observe(inspection(1))).toBeNull();
    expect(tracker.observe({ ...inspection(2), failed: true })).toBeNull();
    expect(tracker.observe(inspection(3))).toBeNull();
    expect(tracker.observe({ ...inspection(4), failed: true })).toBeNull();
    expect(tracker.observe(inspection(5))).toMatchObject({ toolName: "shell", repeats: 3 });
  });

  it("counts two calls alternated with unchanged answers as the same stall", () => {
    const tracker = createStallTracker();
    const read = (n: number) => ({
      toolName: "read",
      input: { path: "package.json" },
      failed: false,
      output: `{"version":"1"}${trailer(n)}`,
    });
    expect(tracker.observe(inspection(1))).toBeNull();
    expect(tracker.observe(read(2))).toBeNull();
    expect(tracker.observe(inspection(3))).toBeNull();
    expect(tracker.observe(read(4))).toBeNull();
    expect(tracker.observe(inspection(5))).toMatchObject({ toolName: "shell", repeats: 3 });
  });

  it("starts over after an edit, and again when a reread shows the edit", () => {
    const tracker = createStallTracker();
    tracker.observe(inspection(1));
    tracker.observe(inspection(2));
    expect(
      tracker.observe({
        toolName: "write",
        input: { path: "package.json", content: "x" },
        failed: false,
        output: `written${trailer(3)}`,
      }),
    ).toBeNull();
    // The same inspection after an edit: the window still remembers it, so it counts, but the
    // edit reset the run of repeats and this is the first.
    expect(tracker.observe(inspection(4))).toBeNull();
    expect(tracker.observe(inspection(5, "exit code: 0\nstdout:\n3.0.4"))).toBeNull();
    expect(tracker.observe(inspection(6, "exit code: 0\nstdout:\n3.0.4"))).toBeNull();
    expect(tracker.observe(inspection(7, "exit code: 0\nstdout:\n3.0.4"))).toBeNull();
    expect(tracker.observe(inspection(8, "exit code: 0\nstdout:\n3.0.4"))).toMatchObject({
      toolName: "shell",
      repeats: 3,
    });
  });

  it("forgets what fell out of the window, so a reread much later is new again", () => {
    const tracker = createStallTracker({ window: 4, threshold: 3 });
    tracker.observe(inspection(1));
    for (let n = 2; n <= 6; n += 1)
      tracker.observe(inspection(n, `exit code: 0\nstdout:\nfile ${n}`));
    expect(tracker.observe(inspection(7))).toBeNull();
  });

  it("reads argument objects the same whatever their key order", () => {
    const tracker = createStallTracker();
    const call = (input: object, n: number) => ({
      toolName: "search",
      input,
      failed: false,
      output: `none${trailer(n)}`,
    });
    tracker.observe(call({ pattern: "a", path: "src" }, 1));
    tracker.observe(call({ path: "src", pattern: "a" }, 2));
    tracker.observe(call({ pattern: "a", path: "src" }, 3));
    expect(tracker.observe(call({ path: "src", pattern: "a" }, 4))).toMatchObject({
      toolName: "search",
      repeats: 3,
    });
  });

  it("resets its count after an intervention and keeps the window", () => {
    const tracker = createStallTracker();
    for (let n = 1; n <= 4; n += 1) tracker.observe(inspection(n));
    tracker.reset();
    expect(tracker.observe(inspection(5))).toBeNull();
    expect(tracker.observe(inspection(6))).toBeNull();
    expect(tracker.observe(inspection(7))).toMatchObject({ toolName: "shell", repeats: 3 });
  });

  it("writes a notice that names the harness, the tool, the count, the call and its answer", () => {
    const notice = stallNotice({
      toolName: "search",
      repeats: 3,
      input: '{"path":".","pattern":"emitWsNeeded"}',
      output: "no match for /emitWsNeeded/",
      landed: false,
    });
    expect(notice.startsWith(stallNoticePrefix)).toBe(true);
    expect(notice).toContain("The last 4 search calls");
    // A notice that only said "you repeated yourself" was followed by the same search under
    // another directory and then as a shell grep; the name it kept looking for is what it
    // has to be told is not there.
    expect(notice).toContain('search {"path":".","pattern":"emitWsNeeded"}');
    expect(notice).toContain('began: "no match for /emitWsNeeded/"');
    expect(notice).toContain("not in this workspace");
    expect(notice).toContain("ends this loop");
  });

  it("reports the repeated call and its answer with the stall, bounded and without the trailer", () => {
    const tracker = createStallTracker();
    const long = "x".repeat(500);
    let stall = null;
    for (let index = 0; index < 4; index += 1)
      stall = tracker.observe({
        toolName: "search",
        input: { pattern: long, path: "." },
        failed: false,
        output: `no match for /${long}/\n[evidence record sha256:${"0".repeat(64)} kind tool-call:search]`,
      });
    expect(stall?.repeats).toBe(3);
    expect(stall?.input.length).toBeLessThanOrEqual(243);
    expect(stall?.input.startsWith('{"path":".","pattern":"xxx')).toBe(true);
    expect(stall?.output.length).toBeLessThanOrEqual(243);
    expect(stall?.output).not.toContain("evidence record");
  });
});

describe("an answer given before an edit", () => {
  const edit = (n: number, failed = false) => ({
    toolName: "edit",
    input: { path: "src/rules.ts", find: "a", replace: "b" },
    failed,
    output: failed
      ? `no occurrence of the search text in src/rules.ts${trailer(n)}`
      : `replaced 1 occurrence(s) in src/rules.ts${trailer(n)}`,
    writes: true,
  });

  it("is not an answer the model has about the workspace after it, even when the answer is unchanged", () => {
    // The planned-check trial of 2026-10-20 (run 20261020T045117-41e2cc, records 530, 591 and
    // 597): the build and visible check ran, the file was edited, and the same build and check
    // ran again with the same output. The second run was a new answer about a new workspace.
    const tracker = createStallTracker();
    expect(tracker.observe(inspection(1))).toBeNull();
    expect(tracker.observe(edit(2))).toBeNull();
    expect(tracker.observe(inspection(3))).toBeNull();
    expect(tracker.repeats()).toBe(0);
  });

  it("stays an answer the model has when the edit between did not land", () => {
    const tracker = createStallTracker();
    tracker.observe(inspection(1));
    tracker.observe(edit(2, true));
    tracker.observe(inspection(3));
    expect(tracker.repeats()).toBe(1);
  });

  it("still counts the same inspection repeated with no edit between, and the same edit repeated", () => {
    const tracker = createStallTracker();
    tracker.observe(edit(1));
    for (let n = 2; n <= 4; n += 1) tracker.observe(inspection(n));
    expect(tracker.repeats()).toBe(2);
    // A write repeated byte for byte with the same answer is a repeat whatever it landed on:
    // the alternative, forgetting everything at every write, would never count one.
    const writes = createStallTracker();
    writes.observe(edit(1));
    writes.observe(edit(2));
    expect(writes.repeats()).toBe(1);
  });

  it("names what the harness knows in the notice: no writing call has landed, not that nothing changed", () => {
    const notice = repeatedAnswerNotice("shell", `exit code: 0${trailer(1)}`, 1);
    expect(notice).toContain("No writing tool call has landed since");
    expect(notice).not.toContain("Nothing in the workspace changed");
    const stall = stallNotice({
      toolName: "shell",
      repeats: 3,
      input: "{}",
      output: "exit code: 0",
      landed: false,
    });
    expect(stall).toContain("no writing tool call landed between them");
    expect(stall).not.toContain("nothing in the workspace changed");
  });
});

describe("the state an answer concerns, apart from whether the call may write", () => {
  // The shell is named as a tool whose call may write, since the harness cannot see what a
  // command did. That says nothing about which workspace a command's answer is about: a check
  // run before an edit answered about the workspace before it, and the same check after the edit
  // is a new question, whatever the check itself could have changed.
  const write = (n: number) => ({
    toolName: "write",
    input: { path: "src/rules.ts", content: "export const a = 1;\n" },
    failed: false,
    output: `wrote 20 bytes to src/rules.ts${trailer(n)}`,
    writes: true,
  });
  const check = (n: number) => ({
    toolName: "shell",
    input: { command: "node --check src/rules.ts" },
    failed: false,
    output: `exit code: 0${trailer(n)}`,
    writes: true,
  });
  const read = (n: number) => ({
    toolName: "read",
    input: { path: "src/rules.ts" },
    failed: false,
    output: `export const a = 1;${trailer(n)}`,
  });

  it("answers a shell check repeated after an edit that landed, though the check may write", () => {
    // 33fbf1693 keyed every call that may write without the generation, so this check was
    // compared with its answer from before the edit and its fresh result was withheld.
    const tracker = createStallTracker();
    expect(tracker.observe(check(1))).toBeNull();
    expect(tracker.observe(write(2))).toBeNull();
    expect(tracker.observe(check(3))).toBeNull();
    expect(tracker.repeats()).toBe(0);
  });

  it("answers an inspection repeated after a shell command that landed", () => {
    const tracker = createStallTracker();
    expect(tracker.observe(read(1))).toBeNull();
    expect(tracker.observe(check(2))).toBeNull();
    expect(tracker.observe(read(3))).toBeNull();
    expect(tracker.repeats()).toBe(0);
  });

  it("still counts an inspection repeated with nothing between", () => {
    const tracker = createStallTracker();
    for (let n = 1; n <= 3; n += 1) tracker.observe(read(n));
    expect(tracker.repeats()).toBe(2);
  });

  it("still counts a successful call that may write repeated with nothing else between, and says it landed", () => {
    // Repeated successful writes of the same bytes, or the same shell command with the same
    // answer, are one more thing the model is doing again; the detection stays. What a repeat
    // of one establishes is that no other call that may write landed between the two.
    const tracker = createStallTracker();
    let stall = null;
    for (let n = 1; n <= 4; n += 1) stall = tracker.observe(write(n));
    expect(tracker.repeats()).toBe(3);
    expect(stall).toMatchObject({ toolName: "write", repeats: 3, landed: true });
    const commands = createStallTracker();
    for (let n = 1; n <= 4; n += 1) stall = commands.observe(check(n));
    expect(stall).toMatchObject({ toolName: "shell", repeats: 3, landed: true });
    const inspections = createStallTracker();
    for (let n = 1; n <= 4; n += 1) stall = inspections.observe(inspection(n));
    expect(stall).toMatchObject({ toolName: "shell", repeats: 3, landed: false });
  });

  it("counts a denied call repeated unchanged, as one that did not land", () => {
    const tracker = createStallTracker();
    const denied = (n: number) => ({ ...check(n), failed: true, output: `denied${trailer(n)}` });
    let stall = null;
    for (let n = 1; n <= 4; n += 1) stall = tracker.observe(denied(n));
    expect(tracker.repeats()).toBe(3);
    expect(stall).toMatchObject({ toolName: "shell", repeats: 3, landed: false });
  });

  it("says in the notices what a repeat establishes: no other writing call landed between", () => {
    // A repeat of a call that landed is one of the writing calls, so "no writing call landed
    // since" would be false of it; what the same generation shows is that no other one did. A
    // repeat of a call that did not land, denied or an inspection, shows none landed at all.
    const repeatedWrite = repeatedAnswerNotice("write", `wrote 20 bytes${trailer(1)}`, 1, {
      landed: true,
    });
    expect(repeatedWrite).toContain("[harness notice: already answered]");
    expect(repeatedWrite).toContain("its result is unchanged");
    expect(repeatedWrite).toContain("No other writing tool call has landed between the two");
    expect(repeatedWrite).not.toContain("No writing tool call has landed since");
    const repeatedInspection = repeatedAnswerNotice("read", `import x${trailer(2)}`, 1, {
      landed: false,
    });
    expect(repeatedInspection).toContain("No writing tool call has landed since");
    expect(repeatedInspection).not.toContain("No other writing tool call");
    const stalledWrites = stallNotice({
      toolName: "shell",
      repeats: 3,
      input: String.raw`{"command":"node -e \"require('fs').writeFileSync('a','1')\""}`,
      output: "exit code: 0",
      landed: true,
    });
    expect(stalledWrites).toContain("The last 4 shell calls");
    expect(stalledWrites).toContain("results you had already received");
    expect(stalledWrites).toContain("no other writing tool call landed between them");
    const stalledInspections = stallNotice({
      toolName: "read",
      repeats: 3,
      input: '{"path":"a"}',
      output: "1",
      landed: false,
    });
    expect(stalledInspections).toContain(", and no writing tool call landed between them");
  });
});

describe("what the tracker says between stalls", () => {
  it("counts the repeats as they happen, and forgets them all when told the answers are gone", () => {
    const tracker = createStallTracker();
    tracker.observe(inspection(1));
    expect(tracker.repeats()).toBe(0);
    tracker.observe(inspection(2));
    expect(tracker.repeats()).toBe(1);
    tracker.observe(inspection(3));
    expect(tracker.repeats()).toBe(2);
    // After compaction the earlier answers are not in the conversation, so the same call is new.
    tracker.forget();
    expect(tracker.repeats()).toBe(0);
    expect(tracker.observe(inspection(4))).toBeNull();
    expect(tracker.repeats()).toBe(0);
  });

  it("hands the model a notice in the answer's place that names the call and quotes the answer's first line", () => {
    const notice = repeatedAnswerNotice("read", `import {\n    WhiteSpace${trailer(9)}`, 2);
    expect(notice).toContain("[harness notice: already answered]");
    expect(notice).toContain("This read call is identical");
    expect(notice).toContain("2 times now");
    expect(notice).toContain('"import {"');
    expect(notice).not.toContain("WhiteSpace");
  });
});
