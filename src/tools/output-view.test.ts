import { describe, expect, it } from "vitest";
import { defaultOutputViewLimits, outputView } from "./output-view.ts";

const record = `sha256:${"cd".repeat(32)}`;

/** A runner's log of `count` passing lines with one failure at `failAt`, ending in a summary. */
function longLog(count: number, failAt: number | null, summary: string): string {
  const lines = ["exit code: 1", "stdout:"];
  for (let index = 1; index <= count; index += 1)
    lines.push(
      index === failAt
        ? `not ok ${index} - parses a date: expected 2020-01-01 but got 2019-12-31`
        : `ok ${index} - case ${index} passes with a long enough description to fill the log`,
    );
  lines.push(summary);
  return lines.join("\n");
}

describe("the bounded view of a long tool output", () => {
  it("leaves an output within the limit as it is", () => {
    expect(
      outputView({
        text: "exit code: 0\nstdout:\nok",
        facts: { exitCode: 0 },
        record,
        kind: "tool-call:shell",
      }),
    ).toBeNull();
  });

  it("states the recorded exit status and the omission, and points at a failure in the omitted middle", () => {
    const text = longLog(2_000, 1_000, "# tests 2000\n# pass 1999\n# fail 1");
    const view = outputView({
      text,
      facts: { exitCode: 1, timedOut: false, cancelled: false, truncated: false },
      record,
      kind: "tool-call:shell",
    });
    expect(view).not.toBeNull();
    const shown = view ?? "";
    expect(shown.length).toBeLessThanOrEqual(defaultOutputViewLimits.maxChars + 1_000);
    expect(shown).toContain(
      "recorded status: exit code 1, not timed out, not cancelled, capture complete",
    );
    expect(shown).toMatch(
      /the full output is [\d,]+ characters in 2,005 lines, kept on evidence record sha256:c{1}d/,
    );
    expect(shown).toMatch(/lines \d[\d,]* to [\d,]+ omitted/);
    // The failure the runner printed in the middle is pointed at, with its line number.
    expect(shown).toContain("1,002: not ok 1000 - parses a date");
    expect(shown).toContain("a text match to point at them, not a verdict");
    // The tail, where runners print their summary, is shown.
    expect(shown).toContain("# fail 1");
    expect(shown).toContain(`read_recorded_output {"record":"${record}"`);
  });

  it("never reads success off the excerpt: a failing status stands whatever the shown lines say", () => {
    const text = longLog(2_000, null, "all tests passed");
    const shown =
      outputView({
        text,
        facts: { exitCode: 2, timedOut: false, cancelled: false, truncated: false },
        record,
        kind: "tool-call:shell",
      }) ?? "";
    expect(shown).toContain("recorded status: exit code 2");
    expect(shown).toContain("all tests passed");
    expect(shown).toContain("nothing about the omitted lines follows from this excerpt");
  });

  it("names a timeout, a cancellation and a capture cut at its limit", () => {
    const text = longLog(2_000, null, "...");
    const shown =
      outputView({
        text,
        facts: { exitCode: 137, timedOut: true, cancelled: true, truncated: true },
        record,
        kind: "tool-call:shell",
      }) ?? "";
    expect(shown).toContain("exit code 137, timed out, cancelled, capture truncated at its limit");
  });

  it("does not point at a line the runner marks as passing, whatever the test is called", () => {
    const lines = ["exit code: 1", "stdout:"];
    for (let index = 1; index <= 2_000; index += 1)
      lines.push(
        index === 700
          ? "  ✔ Links should fail example 503 (0.06ms)"
          : index === 900
            ? "  ✖ Links example 7 (0.1ms)"
            : `  ✔ case ${index} (0.05ms) with a description`,
      );
    const shown =
      outputView({
        text: lines.join("\n"),
        facts: { exitCode: 1 },
        record,
        kind: "tool-call:shell",
      }) ?? "";
    expect(shown).not.toContain("702:");
    expect(shown).toContain("902:   ✖ Links example 7");
  });

  it("says where no status was recorded rather than inventing one", () => {
    const shown =
      outputView({ text: "x\n".repeat(20_000), facts: {}, record, kind: "tool-call:search" }) ?? "";
    expect(shown).toContain("recorded status: none recorded for this tool");
  });

  it("cuts a single line longer than the view and still says what was omitted", () => {
    const shown =
      outputView({
        text: `exit code: 0\nstdout:\n${"y".repeat(50_000)}`,
        facts: { exitCode: 0 },
        record,
        kind: "tool-call:shell",
      }) ?? "";
    expect(shown.length).toBeLessThanOrEqual(defaultOutputViewLimits.maxChars + 1_000);
    expect(shown).toContain("characters of line 3 omitted");
  });
});
