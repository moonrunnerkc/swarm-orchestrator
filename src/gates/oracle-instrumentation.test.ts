import { describe, expect, it } from "vitest";
import { instrumentedOracle } from "./oracle-instrumentation.ts";

/**
 * A real oracle command is a compound shell string: it puts the held-back test file in place and
 * then runs it. `harnessReportingCommand` only vouches a bare node invocation, so reach came back
 * `unmeasured` on koa#1946, the very case the check was built for.
 *
 * The setup before the final command is the harness's own mkdir and cp. Only the last segment
 * needs instrumenting, and only if it is a node test run the harness can rebuild itself.
 */
describe("instrumenting a compound oracle command", () => {
  it("separates the setup from a final node test run it can rebuild", () => {
    const found = instrumentedOracle(
      `mkdir -p "$(dirname a/b.test.js)" && cp '/corpus/b.test.js' 'a/b.test.js' && node --test '--test-name-pattern' 'x' 'a/b.test.js'`,
    );

    expect(found).not.toBeNull();
    expect(found?.setup).toContain("mkdir -p");
    expect(found?.setup).toContain("cp '/corpus/b.test.js'");
    expect(found?.argv[0]).toBe("node");
    expect(found?.argv).toContain("--experimental-test-coverage");
    expect(found?.argv).toContain("a/b.test.js");
  });

  it("gives up on a final command it cannot rebuild, rather than guessing", () => {
    expect(instrumentedOracle("cp x y && npx jest --ci -t 'x' a.test.js")).toBeNull();
    expect(instrumentedOracle("grep -q 'v < 0' clamp.mjs")).toBeNull();
  });

  // A shell operator the harness did not put there decides what runs, and rebuilding around it
  // means predicting a shell. Invariant 7 refuses that for the ratchet and it is refused here.
  it("gives up when the final segment carries a shell operator", () => {
    expect(instrumentedOracle("cp x y && node --test a.test.js | tee out")).toBeNull();
  });

  /**
   * A title filter joins case names with a regex alternation, so the pipe is inside single quotes
   * where a shell reads it as a character. Rejecting the segment for containing one refuses every
   * real oracle: koa#1946's filter is
   * 'should defer AsyncLocalStorage creation when building snapshot|should work normally after
   * deserialization', and reach stayed unmeasured on the case the check exists for.
   */
  it("reads an operator inside quotes as the character it is", () => {
    const found = instrumentedOracle(
      `cp '/corpus/b.test.js' 'a/b.test.js' && node --test '--test-name-pattern' 'first|second' 'a/b.test.js'`,
    );

    expect(found).not.toBeNull();
    expect(found?.argv).toContain("first|second");
  });
});
