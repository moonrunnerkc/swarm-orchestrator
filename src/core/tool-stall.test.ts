import { describe, expect, it } from "vitest";
import { createStallTracker, stallNotice, stallNoticePrefix } from "./tool-stall.ts";

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
    expect(tracker.observe(inspection(4))).toEqual({ toolName: "shell", repeats: 3 });
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
    expect(tracker.observe(inspection(5))).toEqual({ toolName: "shell", repeats: 3 });
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
    expect(tracker.observe(inspection(5))).toEqual({ toolName: "shell", repeats: 3 });
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
    expect(tracker.observe(inspection(8, "exit code: 0\nstdout:\n3.0.4"))).toEqual({
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
    expect(tracker.observe(call({ path: "src", pattern: "a" }, 4))).toEqual({
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
    expect(tracker.observe(inspection(7))).toEqual({ toolName: "shell", repeats: 3 });
  });

  it("writes a notice that names the harness, the tool and the count", () => {
    const notice = stallNotice({ toolName: "shell", repeats: 3 });
    expect(notice.startsWith(stallNoticePrefix)).toBe(true);
    expect(notice).toContain("The last 4 shell calls");
    expect(notice).toContain("ends this loop");
  });
});
