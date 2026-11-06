import { describe, expect, it } from "vitest";
import { excludingCases, failingCases, refusedName } from "./authored-cases.ts";

// pubprep (2026-11-05, rc.7 sealed-set run): seven of nine cases failed at the base as a feature's
// should ("Unknown flag: --reviewers"); two passed a predicate to toThrow and failed on every tree.
const vitest = [
  " FAIL  test/cli-main.swarm-r1.test.ts > Reviewers Option > parseArgs > parses a single reviewer",
  "Error: Unknown flag: --reviewers. Run pubprep --help for usage.",
  " ❯ Module.parseArgs src/cli.ts:101:15",
  " FAIL  test/cli-main.swarm-r1.test.ts > Reviewers Option > parseArgs > throws error for missing or empty value",
  "TypeError: Cannot read properties of undefined (reading 'constructor')",
].join("\n");

describe("the failing cases a run names", () => {
  it("reads vitest's and pytest's, each with the first line of its error", () => {
    expect(failingCases(vitest)).toEqual([
      {
        title: "parses a single reviewer",
        error: "Error: Unknown flag: --reviewers. Run pubprep --help for usage.",
      },
      {
        title: "throws error for missing or empty value",
        error: "TypeError: Cannot read properties of undefined (reading 'constructor')",
      },
    ]);
    expect(
      failingCases("FAILED tests/test_a.py::TestScan::test_keeps_lines - assert 3 == 4"),
    ).toEqual([{ title: "test_keeps_lines", error: "assert 3 == 4" }]);
  });
});

describe("a check with some cases left out", () => {
  it("is narrowed by the runner's own name filter", () => {
    expect(excludingCases("npx vitest run test/a.test.ts", ["throws (on) x"])).toBe(
      "npx vitest run test/a.test.ts -t '^(?!.*(?:throws \\(on\\) x)).*$'",
    );
    expect(excludingCases("python3 -m pytest -q tests/test_a.py", ["test_x", "test_y"])).toBe(
      "python3 -m pytest -q tests/test_a.py -k 'not (test_x or test_y)'",
    );
    expect(excludingCases("npx mocha test/a.js", ["x"])).toBeNull();
  });
});

describe("a name the code refused at the base", () => {
  // tracemantle c4dc276c4 (2026-11-05, rc.19): cases wrote config keys of their own invention.
  const task =
    "Harden skillcheck.toml handling: a wrong-typed value must name the value it got, as in \"Config key 'max-lines' must be an integer (got 'nope')\". The CLI takes `--strict`.";

  it("is named where the task never names it", () => {
    expect(refusedName(`assert 'x' in "Unknown config key 'author' in /tmp/s.toml"`, task)).toBe(
      "Unknown config key 'author'",
    );
  });

  it("is not where the task quotes it, in an example or as a flag", () => {
    expect(refusedName("Unknown config key 'max-lines' in /tmp/s.toml", task)).toBeNull();
    expect(refusedName("error: unknown option '--strict'", task)).toBeNull();
  });
});

describe("pytest's failing cases", () => {
  it("carry the E lines of their section, where the summary cuts the message or gives none", () => {
    const output = [
      "___________________ test_string_type ___________________",
      "E       assert 'must be a string' in \"Unknown config key 'author'\"",
      "=========================== short test summary info ============================",
      "FAILED tests/test_x.py::test_string_type - as...",
      "FAILED tests/test_x.py::test_cli_prints",
    ].join("\n");
    expect(failingCases(output)).toEqual([
      {
        title: "test_string_type",
        error: "as... assert 'must be a string' in \"Unknown config key 'author'\"",
      },
      { title: "test_cli_prints", error: "" },
    ]);
  });
});
