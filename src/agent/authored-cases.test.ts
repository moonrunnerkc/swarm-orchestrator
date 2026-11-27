import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  failingCases,
  layFile,
  onlyCase,
  passedAlone,
  refusedName,
  removeLaid,
} from "./authored-cases.ts";

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

describe("a check run one case at a time", () => {
  it("selects the case by the runner's own name filter, where it has one this knows", () => {
    expect(onlyCase("npx vitest run test/a.test.ts", "throws (on) x")).toBe(
      "npx vitest run test/a.test.ts -t 'throws \\(on\\) x$'",
    );
    expect(onlyCase("python3 -m pytest -q tests/test_a.py", "test_x")).toBe(
      "python3 -m pytest -q tests/test_a.py -k 'test_x'",
    );
    expect(onlyCase("npx mocha test/a.js", "x")).toBeNull();
  });

  // node reads options only before the first file: written after it, the filter reached nobody
  // and every run meant for one case was the whole file (found on node 24.15, 2026-11-26).
  it("puts node's name filter before the file, where node reads it", () => {
    expect(onlyCase("node --test test/a.test.ts", "control: sums")).toBe(
      "node --test --test-name-pattern='control: sums$' test/a.test.ts",
    );
  });

  it("counts a selected case as passing only where the run shows it, since a filter matching nothing exits 0", () => {
    const none = "\u2714 test/a.test.ts (40.04ms)\n\u2139 tests 1\n\u2139 pass 1\n";
    expect(passedAlone(none, "control: sums")).toBe(false);
    expect(passedAlone("\u2714 control: sums (0.26ms)\n\u2139 tests 1\n", "control: sums")).toBe(
      true,
    );
    expect(passedAlone(" Test Files  1 skipped (1)\n      Tests  2 skipped (2)\n", "x")).toBe(
      false,
    );
    expect(passedAlone("      Tests  1 passed | 1 skipped (2)\n", "x")).toBe(true);
    expect(passedAlone("1 passed, 2 deselected in 0.01s\n", "test_x")).toBe(true);
  });
});

describe("a check laid into the tree", () => {
  // The harness writes and removes these on the host; the tree is the model's to rearrange.
  it("is refused where its directory is a link out of the workspace, and replaces a link at its own path", async () => {
    const root = await mkdtemp(join(tmpdir(), "laid-"));
    const [workspace, outside] = [join(root, "work"), join(root, "outside")];
    await mkdir(workspace);
    await mkdir(outside);
    await writeFile(join(outside, "victim.txt"), "kept");
    await symlink(outside, join(workspace, "test"));
    await expect(layFile(workspace, "test/a.test.ts", "x")).rejects.toThrow(
      /resolves outside the workspace/,
    );
    await expect(removeLaid(workspace, "test/victim.txt")).rejects.toThrow(
      /resolves outside the workspace/,
    );
    await symlink(join(outside, "victim.txt"), join(workspace, "b.test.ts"));
    await layFile(workspace, "b.test.ts", "laid");
    expect(await readFile(join(outside, "victim.txt"), "utf8")).toBe("kept");
    expect(await readFile(join(workspace, "b.test.ts"), "utf8")).toBe("laid");
    await layFile(workspace, "new/dir/c.test.ts", "made");
    expect(await readFile(join(workspace, "new/dir/c.test.ts"), "utf8")).toBe("made");
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

  // pubprep's recorded check (the release smoke): three sound cases failed at the base on the
  // message the feature replaces, and were read as refused names and left out for six releases.
  it("is not read from an assertion's own quoting of the message it expected", () => {
    const error =
      "AssertionError: expected 'Unknown flag: --reviewers. Run pubprep --help' to contain 'tech-debt'";
    expect(
      refusedName(error, "Add a --reviewers option; names are tech-debt, docs and security."),
    ).toBeNull();
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

describe("node:test output", () => {
  // As recorded at the base of a live run on 2026-11-26, where a failing control went unread.
  const output = [
    "✖ returns invoice JSON for the owner (0.555423ms)",
    "✖ control: authenticated user can access their own data (0.075294ms)",
    "ℹ tests 2",
    "ℹ fail 2",
    "",
    "✖ failing tests:",
    "",
    "test at test/invoices.swarm-r1.test.ts:9:1",
    "✖ returns invoice JSON for the owner (0.555423ms)",
    "  AssertionError [ERR_ASSERTION]: Test requires an invoice owned by the user",
    "      at TestContext.<anonymous> (file:///repo/test/invoices.swarm-r1.test.ts:13:10)",
    "",
    "test at test/invoices.swarm-r1.test.ts:61:1",
    "✖ control: authenticated user can access their own data (0.075294ms)",
    "  AssertionError [ERR_ASSERTION]: User should have at least one invoice",
  ].join("\n");

  it("names each failing case with its error, a control among them", () => {
    expect(failingCases(output)).toEqual([
      {
        title: "returns invoice JSON for the owner",
        error: "AssertionError [ERR_ASSERTION]: Test requires an invoice owned by the user",
      },
      {
        title: "control: authenticated user can access their own data",
        error: "AssertionError [ERR_ASSERTION]: User should have at least one invoice",
      },
    ]);
  });
});
