import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { taskCodeStatements } from "../task-code-statements.ts";
import type { GateCommandRunner, GateDefinition, GateObservation } from "./gate-definition.ts";
import type { GateCycle } from "./gate-runner.ts";
import { createTestRetention, testBlocks } from "./retained-tests.ts";

const run = promisify(execFile);

describe("the tests a file declares", () => {
  it("reads each test by its written name with its whole call, and nothing it cannot follow", () => {
    const text = [
      'import { test } from "node:test";',
      'test("adds (one)", () => { assert.equal(add(1, 1), 2); }); // a comment with )',
      "it('keeps \\'quotes\\'', async () => {",
      '  const text = "a ) b";',
      "  /* ( */ assert.ok(text);",
      "});",
      "test(name, () => {});",
      'test.skip("skipped", () => {});',
      "test(`templated ${x}`, () => {});",
      'test("adds (one)", () => {});',
    ].join("\n");
    expect(testBlocks(text)).toEqual([
      {
        name: "adds (one)",
        source: 'test("adds (one)", () => { assert.equal(add(1, 1), 2); });',
      },
      {
        name: "keeps \\'quotes\\'",
        source:
          "it('keeps \\'quotes\\'', async () => {\n  const text = \"a ) b\";\n  /* ( */ assert.ok(text);\n});",
      },
      { name: "adds (one) #2", source: 'test("adds (one)", () => {});' },
    ]);
  });
});

/**
 * A real project on node's own runner: `count(input, each)` asks `each` once per key, except the
 * October 24 shape, which asks about the first key twice. The worker's test of the call count
 * fails on that candidate and passes on the fixed one.
 */
describe("a test the worker deleted or changed, run again on later candidates", () => {
  let root = "";
  let evidence: EvidenceRecorder;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "swarm-retained-"));
    evidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "retained",
      clock: createTestClock(1_700_000_000_000),
    });
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const twice =
    "export function count(input, each) {\n  const keys = input.split('&');\n  for (const key of keys) if (each(key)) break;\n  for (const key of keys) each(key);\n}\n";
  const once =
    "export function count(input, each) {\n  for (const key of input.split('&')) each(key);\n}\n";
  const header =
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { count } from './count.mjs';\n";
  const kept = "test('runs', () => { count('a', () => true); });\n";
  const callCount =
    "test('asks once per key', () => {\n  const calls = [];\n  count('a&b', (key) => { calls.push(key); return true; });\n  assert.deepEqual(calls, ['a', 'b']);\n});\n";
  const wrongCount =
    "test('asks once per key', () => {\n  const calls = [];\n  count('a&b', (key) => { calls.push(key); return true; });\n  assert.deepEqual(calls, ['a', 'b', 'c']);\n});\n";

  const commands: GateCommandRunner = {
    run: () => Promise.reject(new Error("only the vector is used here")),
    runVouched: async (argv, options): Promise<GateObservation> => {
      const ran = await run(argv[0] as string, argv.slice(1), { cwd: options.cwd }).then(
        (done) => ({ exitCode: 0, stdout: done.stdout, stderr: done.stderr }),
        (failed: { code?: number; stdout?: string; stderr?: string }) => ({
          exitCode: failed.code ?? 1,
          stdout: failed.stdout ?? "",
          stderr: failed.stderr ?? "",
        }),
      );
      return { ...ran, durationMs: 0, unavailable: null };
    },
  };
  const testsGate = {
    id: "tests",
    source: { kind: "command", command: "node --test", argv: ["node", "--test"] },
  } as unknown as GateDefinition;
  const cycle = (tests: "passed" | "failed", attempt = 0) =>
    ({ attempt, statuses: { tests } }) as unknown as GateCycle;
  const retention = () =>
    createTestRetention({
      workspaceRoot: root,
      evidence,
      statements: taskCodeStatements(
        'count("a&b", () => true) is null, and each is called once for each key.',
      ),
    });

  it("keeps a deleted failing test open, puts the file back byte for byte, and resolves it once the code meets it", async () => {
    const tracked = retention();
    await writeFile(join(root, "count.mjs"), twice);
    tracked.observe("count.test.mjs", `${header}${kept}${callCount}`, 3);
    // The worker deletes the failing test before any gate cycle.
    const file = `${header}${kept}`;
    await writeFile(join(root, "count.test.mjs"), file);
    tracked.observe("count.test.mjs", file, 5);
    const first = await tracked.measure(cycle("passed"), { commands, testsGate });
    expect(first.cases.map((one) => [one.name, one.kind, one.state, one.lastStep])).toEqual([
      ["asks once per key", "deleted", "open", 3],
    ]);
    expect(first.cases[0]?.connection).toEqual(["code-example-1"]);
    expect(first.open).toEqual(["count.test.mjs > asks once per key"]);
    expect(first.brief).toContain("Deleting a test does not answer the question it asked");
    expect(first.brief).toContain("assert.deepEqual(calls, ['a', 'b']);");
    expect(await readFile(join(root, "count.test.mjs"), "utf8")).toBe(file);
    // A later candidate that asks once per key meets the retained test.
    await writeFile(join(root, "count.mjs"), once);
    const later = await tracked.measure(cycle("passed", 1), { commands, testsGate });
    expect(later.cases.map((one) => one.state)).toEqual(["passes"]);
    expect(later.open).toEqual([]);
    expect(later.brief).toBeNull();
  });

  it("reads a corrected expectation as corrected, keeps both versions, and owes nothing for it", async () => {
    const tracked = retention();
    await writeFile(join(root, "count.mjs"), once);
    tracked.observe("count.test.mjs", `${header}${wrongCount}`, 2);
    const file = `${header}${callCount}`;
    await writeFile(join(root, "count.test.mjs"), file);
    tracked.observe("count.test.mjs", file, 4);
    const reading = await tracked.measure(cycle("passed"), { commands, testsGate });
    expect(reading.cases.map((one) => [one.kind, one.state])).toEqual([["changed", "corrected"]]);
    expect(reading.cases[0]?.source).toContain("['a', 'b', 'c']");
    expect(reading.cases[0]?.current).toContain("['a', 'b']");
    expect(reading.open).toEqual([]);
    expect(await readFile(join(root, "count.test.mjs"), "utf8")).toBe(file);
  });

  it("measures nothing where the tests did not pass, and nothing for a reformatted test", async () => {
    const tracked = retention();
    await writeFile(join(root, "count.mjs"), twice);
    tracked.observe("count.test.mjs", `${header}${callCount}`, 1);
    await writeFile(join(root, "count.test.mjs"), header);
    tracked.observe("count.test.mjs", header, 2);
    const unmeasured = await tracked.measure(cycle("failed"), { commands, testsGate });
    expect(unmeasured.cases.map((one) => one.state)).toEqual(["unmeasured"]);
    expect(unmeasured.open).toEqual([]);
    const reformatted = retention();
    reformatted.observe("count.test.mjs", `${header}${callCount}`, 1);
    const spaced = `${header}${callCount.replaceAll("  ", "    ")}`;
    await writeFile(join(root, "count.test.mjs"), spaced);
    reformatted.observe("count.test.mjs", spaced, 2);
    expect((await reformatted.measure(cycle("passed"), { commands, testsGate })).cases).toEqual([]);
  });
});
