import { describe, expect, it } from "vitest";
import { testOutputParser } from "./parsers.ts";

function tapRun(collected: number, passed: number, exitCode = 0) {
  return testOutputParser({
    exitCode,
    stdout: [
      "TAP version 13",
      `1..${collected}`,
      `# tests ${collected}`,
      `# pass ${passed}`,
      `# fail 0`,
      `# skipped 0`,
    ].join("\n"),
    stderr: "",
    durationMs: 10,
    unavailable: null,
  });
}

describe("a test command that found nothing to run", () => {
  it("abstains rather than passing, because it measured nothing", () => {
    // A run wrote five Python files into a workspace whose package.json declares
    // `node --test`. The command found no test of its own, exited 0, and the gate reported
    // the tests passing over code it had never executed.
    const reading = tapRun(0, 0);

    expect(reading.status).toBe("not-applicable");
    expect(reading.detail).toContain("found no tests to run");
  });

  it("still passes a run that actually collected and passed tests", () => {
    expect(tapRun(12, 12).status).toBe("passed");
  });

  it("still fails a run that collected nothing and exited non-zero", () => {
    expect(tapRun(0, 0, 1).status).toBe("failed");
  });
});
