import { describe, expect, it } from "vitest";
import { comparableOutput } from "./comparable-output.ts";

const same = (a: string, b: string) => comparableOutput(a) === comparableOutput(b);

describe("the output the no-progress rule compares", () => {
  it("leaves out the clock and durations a test runner prints on every run", () => {
    // vitest, colour codes stripped
    expect(
      same(
        " Tests  2 passed (2)\n   Start at  14:06:34\n   Duration  134ms (transform 13ms, setup 0ms)\n",
        " Tests  2 passed (2)\n   Start at  14:06:38\n   Duration  141ms (transform 12ms, setup 0ms)\n",
      ),
    ).toBe(true);
    // pytest
    expect(same("==== 3 passed in 0.12s ====", "==== 3 passed in 1.07s ====")).toBe(true);
    // jest
    expect(same("Tests: 4 passed\nTime: 1.234 s", "Tests: 4 passed\nTime: 0.98 s")).toBe(true);
    // node:test
    expect(
      same("ℹ duration_ms 52.1\nok 1 - half (0.5ms)", "ℹ duration_ms 52.1\nok 1 - half (1.25ms)"),
    ).toBe(true);
    // time
    expect(same("real\t0m0.123s", "real\t0m2.004s")).toBe(true);
  });

  it("leaves out timestamps, temporary paths and colour codes", () => {
    expect(same("at 2026-11-02T21:04:05.123Z", "at 2026-11-02T21:04:09.871Z")).toBe(true);
    expect(same("wrote /tmp/abc123/out.json", "wrote /tmp/xyz789/out.json")).toBe(true);
    expect(
      same(
        "cache /var/folders/9x/ab_cd/T/vitest-1/x",
        "cache /private/var/folders/9x/ab_cd/T/vitest-2/x",
      ),
    ).toBe(true);
    expect(same("\u001b[32m✓\u001b[39m half", "✓ half")).toBe(true);
  });

  it("keeps everything that says what happened", () => {
    expect(same(" Tests  2 passed (2)", " Tests  1 failed | 1 passed (2)")).toBe(false);
    expect(same("==== 3 passed in 0.12s ====", "==== 2 passed, 1 failed in 0.12s ====")).toBe(
      false,
    );
    expect(same("expected 2 to be 3", "expected 2 to be 4")).toBe(false);
    expect(same("wrote src/out.json", "wrote src/other.json")).toBe(false);
    expect(same("12 sessions", "13 sessions")).toBe(false);
    expect(same("version 1.2.3", "version 1.2.4")).toBe(false);
  });
});
