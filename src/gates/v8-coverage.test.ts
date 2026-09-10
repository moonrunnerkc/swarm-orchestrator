import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { childEnvironment } from "../exec/child-environment.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { parseLineHits } from "./parsers.ts";
import { lineHitsFromRanges, readV8Coverage } from "./v8-coverage.ts";

const source = `export function used(a) {
  if (a > 0) {
    return "positive";
  }
  return "other";
}

export function neverCalled(b) {
  const doubled = b * 2;
  return doubled;
}
`;

describe("lineHitsFromRanges", () => {
  // The counts node's own V8 coverage reports for this file when only `used(1)` is called. The
  // innermost range wins: the whole script ran, so did `used`, and neither the `return "other"`
  // branch nor `neverCalled` did.
  const asNodeReportsIt = [
    { startOffset: 0, endOffset: source.length, count: 1 },
    { startOffset: source.indexOf("{"), endOffset: source.indexOf("}\n\nexport") + 1, count: 1 },
    {
      startOffset: source.indexOf('  return "other"'),
      endOffset: source.indexOf('other";') + 'other";'.length,
      count: 0,
    },
    {
      startOffset: source.indexOf("export function neverCalled"),
      endOffset: source.lastIndexOf("}") + 1,
      count: 0,
    },
  ];

  it("gives a line the count of the innermost range that covers it", () => {
    const hits = lineHitsFromRanges(source, asNodeReportsIt);

    expect(hits?.[1]).toBe(1);
    expect(hits?.[3]).toBe(1);
    expect(hits?.[5]).toBe(0);
  });

  it("reports every line of a function nobody called as zero", () => {
    const hits = lineHitsFromRanges(source, asNodeReportsIt);

    expect(hits?.[8]).toBe(0);
    expect(hits?.[9]).toBe(0);
    expect(hits?.[10]).toBe(0);
  });

  /**
   * The detection the whole fallback rests on. Under a transforming runner the offsets address
   * the transformed text, not the file: dayjs's `src/index.js` is 11,794 bytes on disk and jest's
   * coverage names offsets past 218,000. Read raw they name lines nobody wrote, and a reach
   * verdict built on them refuses patches for lines that do not exist.
   */
  it("refuses an artifact whose offsets run past the end of the file", () => {
    expect(
      lineHitsFromRanges(source, [{ startOffset: 0, endOffset: 900_000, count: 1 }]),
    ).toBeNull();
  });

  it("names no line where nothing covers the file", () => {
    expect(lineHitsFromRanges(source, [])).toEqual({});
  });
});

describe("readV8Coverage", () => {
  let workspace = "";
  let destination = "";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "swarm-v8-workspace-"));
    destination = await mkdtemp(join(tmpdir(), "swarm-v8-coverage-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  });

  function runner() {
    return createNodeCommandRunner(
      { now: () => 0, sleep: () => Promise.resolve() },
      childEnvironment(process.env, { homeDir: join(workspace, "child-home") }),
    );
  }

  /**
   * The instrument check that matters: the fallback has to measure what the proven arm measures.
   * node's own lcov reporter is the arm reach has always used, so the same run is read both ways
   * and the two are compared line by line. A backend that agrees with it on which lines ran is
   * evidence; one that merely produces numbers is not.
   */
  it("agrees with node's own lcov report about which lines ran", async () => {
    await writeFile(join(workspace, "thing.js"), source);
    await writeFile(
      join(workspace, "thing.test.js"),
      `import { test } from "node:test";
import assert from "node:assert";
import { used } from "./thing.js";

test("uses the positive branch", () => {
  assert.equal(used(1), "positive");
});
`,
    );

    const reported = await runner().runVouched(
      [
        "node",
        "--test",
        "--experimental-test-coverage",
        "--test-isolation=process",
        "--test-reporter=lcov",
        "--test-reporter-destination=stderr",
        "thing.test.js",
      ],
      { cwd: workspace, timeoutMs: 60_000 },
    );
    const fromLcov = parseLineHits(reported.stderr).find((section) => section.file === "thing.js");

    const alsoRan = await runner().runVouched(["node", "--test", "thing.test.js"], {
      cwd: workspace,
      timeoutMs: 60_000,
      environment: { NODE_V8_COVERAGE: destination },
    });
    expect(alsoRan.exitCode).toBe(0);
    const fromV8 = readV8Coverage({
      directory: destination,
      workspaceRoot: workspace,
      files: ["thing.js"],
    });

    expect(fromLcov).toBeDefined();
    expect(fromV8.unusable).toBeNull();
    const measured = fromV8.hits["thing.js"] ?? {};

    // Every line the two both name, they agree about. Where they differ is the blank line
    // between the functions, which node's reporter names with the enclosing script's count and
    // this reader does not name at all. Reach reads an unnamed line as one nothing can run, so a
    // blank line is `reached` either way and the disagreement cannot change a verdict.
    const disagreed = [...(fromLcov?.hits ?? [])].filter(
      ([line, count]) => measured[line] !== undefined && measured[line] > 0 !== count > 0,
    );
    expect(disagreed).toEqual([]);

    // The load-bearing half, stated rather than left to the loop: the lines that did not run are
    // named as zero rather than left out, because a line left out is a line reach calls reached.
    expect([5, 9, 10, 11].map((line) => measured[line])).toEqual([0, 0, 0, 0]);
    expect([1, 2, 3, 4, 6, 8].every((line) => (measured[line] ?? 0) > 0)).toBe(true);
  });

  it("names the file it was asked about, and nothing else", async () => {
    await writeFile(join(workspace, "thing.js"), source);
    await writeFile(
      join(workspace, "thing.test.js"),
      `import { used } from "./thing.js";\nif (used(1) !== "positive") process.exit(1);\n`,
    );
    await runner().runVouched(["node", "thing.test.js"], {
      cwd: workspace,
      timeoutMs: 60_000,
      environment: { NODE_V8_COVERAGE: destination },
    });

    const read = readV8Coverage({
      directory: destination,
      workspaceRoot: workspace,
      files: ["thing.js"],
    });

    expect(Object.keys(read.hits)).toEqual(["thing.js"]);
    expect(read.hits["thing.js"]?.[2]).toBeGreaterThan(0);
  });

  // Not measured is a verdict. An empty directory is the runner having honoured nothing, and
  // reading it as full reach would certify an oracle on a measurement that never happened.
  it("reports an empty directory as unusable rather than as nothing missed", async () => {
    const read = readV8Coverage({
      directory: destination,
      workspaceRoot: workspace,
      files: ["thing.js"],
    });

    expect(read.unusable).not.toBeNull();
  });

  it("reports a directory that is not there as unusable", async () => {
    const read = readV8Coverage({
      directory: join(destination, "never-written"),
      workspaceRoot: workspace,
      files: ["thing.js"],
    });

    expect(read.unusable).not.toBeNull();
  });

  /**
   * A transformed run must not be read as a measurement, and it is detected per file: dayjs under
   * jest names offsets past the end of every source it touches. The whole reading abstains rather
   * than dropping the file, because a file missing from the reading is reported as a file the
   * oracle skipped, which would refuse the patch instead of abstaining on it.
   */
  it("abstains on the whole reading where one file's offsets are transformed", async () => {
    await writeFile(join(workspace, "thing.js"), source);
    await writeFile(
      join(destination, "coverage-transformed.json"),
      JSON.stringify({
        result: [
          {
            scriptId: "1",
            url: new URL(`file://${join(workspace, "thing.js")}`).href,
            functions: [
              { functionName: "", ranges: [{ startOffset: 0, endOffset: 218_614, count: 1 }] },
            ],
          },
        ],
      }),
    );

    const read = readV8Coverage({
      directory: destination,
      workspaceRoot: workspace,
      files: ["thing.js"],
    });

    expect(read.unusable).toContain("thing.js");
    expect(read.hits).toEqual({});
  });

  it("merges the processes that ran, so a line one of them covered is covered", async () => {
    await writeFile(join(workspace, "thing.js"), source);
    const url = new URL(`file://${join(workspace, "thing.js")}`).href;
    const script = (count: number) => ({
      result: [
        {
          scriptId: "1",
          url,
          functions: [
            { functionName: "", ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
            {
              functionName: "neverCalled",
              ranges: [
                {
                  startOffset: source.indexOf("export function neverCalled"),
                  endOffset: source.lastIndexOf("}") + 1,
                  count,
                },
              ],
            },
          ],
        },
      ],
    });
    await writeFile(join(destination, "coverage-1.json"), JSON.stringify(script(0)));
    await writeFile(join(destination, "coverage-2.json"), JSON.stringify(script(3)));

    const read = readV8Coverage({
      directory: destination,
      workspaceRoot: workspace,
      files: ["thing.js"],
    });

    expect(read.hits["thing.js"]?.[9]).toBe(3);
  });

  it("keeps a file the run never loaded out of the reading, which is not the same as unusable", async () => {
    await writeFile(join(workspace, "thing.js"), source);
    await writeFile(join(workspace, "untouched.js"), "export const x = 1;\n");
    await writeFile(
      join(workspace, "thing.test.js"),
      `import { used } from "./thing.js";\nif (used(1) !== "positive") process.exit(1);\n`,
    );
    await runner().runVouched(["node", "thing.test.js"], {
      cwd: workspace,
      timeoutMs: 60_000,
      environment: { NODE_V8_COVERAGE: destination },
    });

    const read = readV8Coverage({
      directory: destination,
      workspaceRoot: workspace,
      files: ["thing.js", "untouched.js"],
    });

    expect(read.unusable).toBeNull();
    expect(read.hits["untouched.js"]).toBeUndefined();
    expect(await readFile(join(workspace, "untouched.js"), "utf8")).toContain("export const x");
  });
});
