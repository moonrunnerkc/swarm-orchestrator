import { describe, expect, it } from "vitest";
import { harnessControlledNodeTest, processIsolation, shellQuoted } from "./node-test-command.ts";

/**
 * The property under test is not "the isolation setting was removed". It is "the harness
 * recognized the whole invocation". The forms below are the ones that beat three rounds of
 * removal, and none of them is recognized: what closes them is that an unrecognized token
 * abstains rather than being argued with.
 */

const reporting = [processIsolation, "--test-reporter=lcov", "--test-reporter-destination='/s/t'"];

describe("an invocation the harness can vouch for", () => {
  it("runs node's own runner with the flags this arm needs, ahead of the file patterns", () => {
    const command = harnessControlledNodeTest("node --test 'src/**/*.test.mjs'", reporting);

    expect(command).toBe(
      "node --test --test-isolation=process --test-reporter=lcov " +
        "--test-reporter-destination='/s/t' 'src/**/*.test.mjs'",
    );
  });

  it("keeps the project's own flags where every one of them is recognized", () => {
    const command = harnessControlledNodeTest(
      "node --experimental-strip-types --test --test-concurrency=2",
      reporting,
    );

    expect(command).toContain("--experimental-strip-types");
    expect(command).toContain("--test-concurrency=2");
  });

  it("runs one named file in place of the project's patterns where an arm asks for that", () => {
    const command = harnessControlledNodeTest("node --test 'src/**/*.test.mjs'", reporting, [
      "'src/one.test.mjs'",
    ]);

    expect(command).toContain("'src/one.test.mjs'");
    expect(command).not.toContain("**");
  });
});

describe("an isolation setting the harness did not write", () => {
  /**
   * Every spelling of the same declaration. The first is the one that beat the rewrite after
   * the rewrite had already been fixed twice; the rest are the shapes the next fix would have
   * had to anticipate, which is the argument for not fixing it that way again.
   */
  const declarations = [
    'node --test --test-isolation="none"',
    "node --test --test-isolation='none'",
    "node --test --test-isolation=`echo none`",
    `node --test --test-isolation=\${ISOLATION}`,
    "node --test --test-isolation=none",
    "node --test --test-isolation = none",
    "node --test --test-isolation＝none",
    "node --test --test_isolation=none",
    "node --test --test-isolation=NONE",
  ];

  it("abstains on every one of them rather than rewriting it", () => {
    for (const body of declarations) {
      expect({ body, command: harnessControlledNodeTest(body, reporting) }).toEqual({
        body,
        command: null,
      });
    }
  });
});

describe("everything else the harness cannot stand behind", () => {
  it("abstains on a wrapper, an operator, an assignment, an expansion, or a hook", () => {
    for (const body of [
      // Not this harness's own process: npm runs pre and post scripts, npx resolves a package.
      "npm test",
      "npx node --test",
      "vitest run",
      "node --test && node other.mjs",
      "node --test | tee out.txt",
      "node --test; node other.mjs",
      "NODE_OPTIONS=--test-isolation=none node --test",
      "node --test $EXTRA",
      // A hook in the process that writes the artifact is the artifact's author.
      "node --require ./setup.cjs --test",
      "node --import ./setup.mjs --test",
      "node --experimental-loader ./hook.mjs --test",
      "node --env-file=.env --test",
      // A reporter or a coverage setting of the project's own, which this arm would be
      // reading the output of rather than measuring.
      "node --test --test-reporter=spec",
      "node --test --experimental-test-coverage",
      // Not a test run at all.
      "node build.mjs",
      "",
    ]) {
      expect({ body, command: harnessControlledNodeTest(body, reporting) }).toEqual({
        body,
        command: null,
      });
    }
    expect(harnessControlledNodeTest(undefined, reporting)).toBeNull();
  });

  it("abstains where its own destination path could not be handed to a shell as a literal", () => {
    expect(shellQuoted("/session/coverage/tests.lcov")).toBe("'/session/coverage/tests.lcov'");
    expect(shellQuoted("/session/it's/tests.lcov")).toBeNull();
    expect(shellQuoted("/session/$(id)/tests.lcov")).toBeNull();
  });

  it("abstains when the flags it was handed do not leave it holding the isolation setting", () => {
    // The confirmation reads the command back rather than trusting that it was built right, so
    // an arm that forgot to ask for process isolation measures nothing instead of measuring
    // under whatever the project would have got.
    expect(harnessControlledNodeTest("node --test", ["--test-reporter=lcov"])).toBeNull();
    expect(
      harnessControlledNodeTest("node --test", [processIsolation, "--test-isolation=none"]),
    ).toBeNull();
  });
});
