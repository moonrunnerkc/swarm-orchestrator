import { describe, expect, it } from "vitest";
import { oracleCoveragePlan } from "./oracle-instrumentation.ts";

/**
 * A real oracle command is a compound shell string: it puts the held-back test file in place and
 * then runs it. The setup before the final command is the harness's own mkdir and cp, so only the
 * last segment is instrumented, and only where this can say how.
 */
describe("instrumenting a compound oracle command", () => {
  const destination = "/scratch/reach-abc";

  it("separates the setup from a final node test run it can rebuild", () => {
    const plan = oracleCoveragePlan(
      `mkdir -p "$(dirname a/b.test.js)" && cp '/corpus/b.test.js' 'a/b.test.js' && node --test '--test-name-pattern' 'x' 'a/b.test.js'`,
      destination,
    );

    expect(plan?.setup).toContain("mkdir -p");
    expect(plan?.setup).toContain("cp '/corpus/b.test.js'");
    expect(plan?.kind).toBe("node-lcov");
    expect(plan?.kind === "node-lcov" && plan.argv[0]).toBe("node");
    expect(plan?.kind === "node-lcov" && plan.argv).toContain("a/b.test.js");
  });

  it("gives up on a final command it cannot make report anything", () => {
    expect(oracleCoveragePlan("grep -q 'v < 0' clamp.mjs", destination)).toBeNull();
  });

  // A shell operator the harness did not put there decides what runs, and rebuilding around it
  // means predicting a shell. Invariant 7 refuses that for the ratchet and it is refused here.
  it("gives up when the final segment carries a shell operator", () => {
    expect(oracleCoveragePlan("cp x y && node --test a.test.js | tee out", destination)).toBeNull();
  });

  /**
   * A title filter joins case names with a regex alternation, so the pipe is inside single quotes
   * where a shell reads it as a character. Rejecting the segment for containing one refuses every
   * real oracle: koa#1946's filter is
   * 'should defer AsyncLocalStorage creation when building snapshot|should work normally after
   * deserialization', and reach stayed unmeasured on the case the check exists for.
   */
  it("reads an operator inside quotes as the character it is", () => {
    const plan = oracleCoveragePlan(
      `cp '/corpus/b.test.js' 'a/b.test.js' && node --test '--test-name-pattern' 'first|second' 'a/b.test.js'`,
      destination,
    );

    expect(plan?.kind === "node-lcov" && plan.argv).toContain("first|second");
  });
});

/**
 * Thirteen of the seventeen repositories in the mined corpus run their tests with something other
 * than node's own runner, and reach was blind on every one of them. The rule it was built on is
 * invariant 7's: an argument vector the harness assembled, no shell in between, an environment it
 * built. That rule exists for the ratchet, where the workspace has motive to inflate a number a
 * retry is judged against. Reach only ever turns a green into a refusal, so a workspace that
 * forged its coverage would land on `reached`, which is where every unrecognized runner already
 * sits: `unmeasured` blocks nothing. Applying the ratchet's bar here cost thirteen repositories
 * and closed no hole.
 */
describe("how an oracle can be asked for coverage", () => {
  const destination = "/scratch/reach-abc";
  const setup = `mkdir -p "$(dirname a/b.test.js)" && cp '/corpus/b.test.js' 'a/b.test.js'`;

  it("still prefers node's own reporter where the harness can rebuild the invocation", () => {
    const plan = oracleCoveragePlan(
      `${setup} && node --test '--test-name-pattern' 'x' 'a/b.test.js'`,
      destination,
    );

    expect(plan?.kind).toBe("node-lcov");
    expect(plan?.kind === "node-lcov" && plan.argv).toContain("--experimental-test-coverage");
  });

  // mocha runs the file untransformed, so V8's own offsets address the file on disk. Measured on
  // winston: the highest offset equals the file size on all eleven lib/ sources.
  it("asks an untransformed runner for V8's own coverage", () => {
    const plan = oracleCoveragePlan(`${setup} && npx mocha --grep 'a|b' 'test/x.js'`, destination);

    expect(plan?.kind).toBe("v8");
    expect(plan?.kind === "v8" && plan.command).toBe("npx mocha --grep 'a|b' 'test/x.js'");
    expect(plan?.kind === "v8" && plan.destination).toBe(destination);
  });

  /**
   * Under jest the V8 offsets address babel's output rather than the file: dayjs's `src/index.js`
   * is 11,794 characters on disk and the coverage names offsets past 218,000. So jest is asked
   * for the report it knows how to write instead, and the flags come last because a command-line
   * coverage setting overrides the project's own configuration in both jest and vitest.
   */
  it("asks a transforming runner for its own lcov report", () => {
    const plan = oracleCoveragePlan(`${setup} && npx jest --ci -t 'x' 'a.test.js'`, destination);

    expect(plan?.kind).toBe("lcov-file");
    expect(plan?.kind === "lcov-file" && plan.command).toContain(
      `--coverageDirectory='${destination}'`,
    );
    expect(plan?.kind === "lcov-file" && plan.command).toContain("--coverageReporters=lcovonly");
    expect(plan?.kind === "lcov-file" && plan.file).toBe(`${destination}/lcov.info`);
  });

  it("uses vitest's own spelling of the same two flags", () => {
    const plan = oracleCoveragePlan(`${setup} && npx vitest run -t 'x' 'a.test.js'`, destination);

    expect(plan?.kind).toBe("lcov-file");
    expect(plan?.kind === "lcov-file" && plan.command).toContain(
      `--coverage.reportsDirectory='${destination}'`,
    );
    expect(plan?.kind === "lcov-file" && plan.command).toContain("--coverage.reporter=lcovonly");
  });

  // The node arm the vouching refuses is not the same as no arm: a loader flag stops the harness
  // rebuilding the invocation, and V8 still reports what the process ran. What the loader does to
  // the offsets is caught where it shows, when the report is read against the file.
  it("falls back to V8 for a node run the harness cannot rebuild", () => {
    const plan = oracleCoveragePlan(
      `${setup} && node --import tsx --test 'a.test.ts'`,
      destination,
    );

    expect(plan?.kind).toBe("v8");
  });

  it("gives up on a runner it does not recognize rather than guessing at flags", () => {
    expect(oracleCoveragePlan(`${setup} && bash run-tests.sh`, destination)).toBeNull();
    expect(
      oracleCoveragePlan(`${setup} && npx ava --match 'x' 'a.test.js'`, destination),
    ).toBeNull();
  });

  it("gives up where a shell decides what the final segment runs", () => {
    expect(oracleCoveragePlan("cp x y && npx mocha a.js | tee out", destination)).toBeNull();
  });

  // A destination the harness names is a path it controls, and it still reaches a shell. One that
  // needs quoting and does not get it runs a different command.
  it("refuses a destination a shell would read as more than a path", () => {
    expect(oracleCoveragePlan(`${setup} && npx jest 'a.test.js'`, "/tmp/a'; rm -rf /")).toBeNull();
  });
});
