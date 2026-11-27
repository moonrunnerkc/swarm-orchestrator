import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { excerpt } from "./affected-tests.ts";
import { failureLine, testsTouched } from "./harness-turn.ts";
import { asksForTests } from "./requirement-record.ts";
import { bash, fixture, noAuthoredCheck, scripted, write } from "./test-doubles.ts";

const wrong = write("half.mjs", "export const half = (n) => n * 3;");
const fix = write("half.mjs", "export const half = (n) => n / 2;");

describe("the harness runs the checks, not the model", () => {
  // t6 and h2 (2026-11-03): one edit to the source, no test run, then the same reads until the
  // read-loop stop, 25 and 18 turns in. Here the checks run after the edit, and the third turn
  // that changes nothing ends the run naming the requirement still failing.
  it("ends a run that edits once and then only reads, naming the failing requirement", async () => {
    const model = scripted([
      wrong,
      bash("cat half.mjs"),
      bash("cat test/half.test.mjs"),
      bash("grep -n half half.mjs"),
      bash("ls"),
      bash("pwd"),
      bash("ls test"),
      bash("wc -l half.mjs"),
    ]);
    const ran = await (await fixture()).run(model, { maxSteps: 20 });
    expect(ran.stop).toBe("no-progress");
    expect(ran.report.reason).toMatch(
      /^6 turns changed neither the tree nor any check's result; R1 still fails: its authored test fails:/,
    );
    expect(ran.report.resources.steps).toBe(7);
    // The fourth quiet turn is told so once, with how many are left.
    expect(model.seen[5]?.at(-1)?.content).toContain(
      "Your last 4 turns changed neither the tree nor any check's result.",
    );
    expect(model.seen[5]?.at(-1)?.content).toContain("2 more turns without a change end the run.");
    expect(model.seen[6]?.at(-1)?.content).not.toContain("Your last 4 turns");
    // In the check's own words, not a guess at what to change (claimcheck, rc.7 sealed-set run).
    expect(model.seen[5]?.at(-1)?.content).toContain("R1 still fails: its authored test fails:");
    expect(ran.report.resources.harnessChecks).toBeGreaterThan(0);
    expect(ran.report.resources.modelTestCommands).toBe(0);
  });

  // claimcheck (2026-11-05, rc.13): the model read the authored test's path three times and was
  // told only that no such file exists.
  it("says what an authored check's path is when the model reads it", async () => {
    const model = scripted([wrong, bash("cat test/half.swarm-r1.test.mjs"), fix]);
    const ran = await (await fixture()).run(model, { maxSteps: 20 });
    expect(ran.report.state).toBe("complete");
    expect(model.seen[2]?.at(-1)?.content).toContain(
      "[test/half.swarm-r1.test.mjs is the independent check written apart from your change.",
    );
  });

  // pubprep and ironroot (2026-11-25, gemma4:31b): three edits in a row whose SEARCH part did not
  // match ended the runs at their ninth and sixth turn, with the next attempt never made.
  it("does not count an edit that did not apply as a turn spent on nothing", async () => {
    const missed = (text: string) =>
      `\`\`\`edit half.mjs\n<<<<<<< SEARCH\n${text}\n=======\nexport const half = (n) => n / 2;\n>>>>>>> REPLACE\n\`\`\``;
    const model = scripted([
      wrong,
      missed("export const half = (n) => n * 8;"),
      missed("export const half = (n) => n * 4;"),
      missed("export const half = (n) => n * 5;"),
      bash("cat half.mjs"),
      missed("export const half = (n) => n * 6;"),
      missed("export const half = (n) => n * 7;"),
      fix,
    ]);
    const ran = await (await fixture()).run(model, { maxSteps: 20 });
    expect(ran.report.state).toBe("complete");
    expect(ran.report.resources.steps).toBe(8);
  });

  it("still ends a run that sends the same edit that does not apply, turn after turn", async () => {
    const missed =
      "```edit half.mjs\n<<<<<<< SEARCH\nnot in the file\n=======\nx\n>>>>>>> REPLACE\n```";
    const ran = await (await fixture()).run(scripted([wrong, missed]), { maxSteps: 20 });
    expect(ran.stop).toBe("no-progress");
    expect(ran.report.reason).toContain("the same command printed the same result 4 turns running");
  });

  it("names a failing line, not a passing case whose title carries the words", () => {
    const detail =
      "its authored test fails:\n ✓ control: reports assertion-removed\n × reports test-removed";
    expect(failureLine(detail)).toBe("its authored test fails: × reports test-removed");
  });

  // depose (replayed 2026-11-05): the author wrote nothing usable, and the stop said only "the
  // task still fails", though nothing had measured it.
  it("says R1 had no independent check when a run with none stops for no progress", async () => {
    const model = scripted(
      [
        wrong,
        bash("cat half.mjs"),
        bash("ls"),
        bash("pwd"),
        bash("ls test"),
        bash("git status --short"),
        bash("wc -l half.mjs"),
      ],
      {
        author: [noAuthoredCheck],
      },
    );
    const ran = await (await fixture()).run(model, { maxSteps: 20 });
    expect(ran.stop).toBe("no-progress");
    expect(ran.report.reason).toBe(
      "6 turns changed neither the tree nor any check's result; R1 has no independent check here (see the report's independent checks), so nothing measured it",
    );
  });

  it("completes on the checks alone when the model never runs a test or marks the task done", async () => {
    const model = scripted([bash("cat half.mjs"), fix, bash("echo never sent")]);
    const ran = await (await fixture()).run(model, { maxSteps: 20 });
    expect(ran).toMatchObject({ stop: "complete", report: { state: "complete" } });
    expect(ran.report.resources).toMatchObject({ steps: 2, modelTestCommands: 0 });
    expect(ran.report.resources.turnsByRequirement).toEqual({ R1: 2 });
  });

  // The refactor task on 2026-11-25: one reply ran past the request's 900 s limit, the same
  // request went out twice more for the same wait, and the run ended on a "dropped connection".
  it("asks for a shorter reply when one outlasts the request's limit, and carries on", async () => {
    const model = scripted([{ content: "", overranMs: 900_000 }, fix, bash("echo never sent")]);
    const ran = await (await fixture()).run(model, { maxSteps: 20 });
    expect(ran).toMatchObject({ stop: "complete", report: { state: "complete" } });
    expect(model.seen[1]?.at(-1)?.content).toContain(
      "it was still being written after 900 s and none of it arrived; send a shorter reply",
    );
  });

  it("keeps a task that asks for tests open until the change adds one", async () => {
    const task = "Make half(n) return n / 2, with a test.";
    const own = write(
      "test/half-exact.test.mjs",
      'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half(6) is 3", () => assert.equal(half(6), 3));',
    );
    const model = scripted([fix, own]);
    const ran = await (await fixture({}, task)).run(model, { maxSteps: 20 });
    expect(ran.report.state).toBe("complete");
    expect(ran.report.resources.steps).toBe(2);
    expect(model.seen[1]?.at(-1)?.content).toContain(
      "the task asks for tests, and the change adds none yet",
    );
  });
});

// cmp-feature-pubprep (Arm C, rc.10, 2026-11-07): at a 32k context the model read the same six
// files in a cycle from step 9 to step 60 and never edited. No turn repeated the one before it,
// so the repeat stop never fired, and the quiet stop starts at the first change.
describe("rereading before the first change", () => {
  const cycle = [bash("cat half.mjs"), bash("cat test/half.test.mjs"), bash("ls")];

  it("is told after four rereads, and ends at the sixth, naming the check still failing", async () => {
    const model = scripted([...cycle, ...cycle, ...cycle, ...cycle]);
    const ran = await (await fixture()).run(model, { maxSteps: 40 });
    expect(ran.stop).toBe("no-progress");
    expect(ran.report.resources.steps).toBe(9);
    expect(ran.report.reason).toMatch(
      /^6 turns running re-ran a command whose output an earlier turn had already printed, before any change; R1's independent check fails at the base, and the tree was never changed$/,
    );
    expect(model.seen[7]?.at(-1)?.content).toContain(
      "Your last 4 commands each printed what an earlier turn of this run had already printed.",
    );
  });

  it("goes on where the model changes the tree before the sixth", async () => {
    const model = scripted([
      ...cycle,
      ...cycle,
      bash("cat half.mjs"),
      bash("cat test/half.test.mjs"),
      fix,
    ]);
    const ran = await (await fixture()).run(model, { maxSteps: 40 });
    expect(ran.report.state).toBe("complete");
  });
});

describe("reading the wording and the diff", () => {
  it("reads a request for tests, and not a test suite that must stay green", () => {
    expect(asksForTests("Fix it, with a test.")).toBe(true);
    expect(asksForTests("Document the flag in the --help text. Add tests.")).toBe(true);
    expect(asksForTests("Typecheck, build and the test suite must stay green.")).toBe(false);
    expect(asksForTests("the tests stay as they are")).toBe(false);
  });

  it("finds the test files a diff adds or changes, the harness's own left out", () => {
    const diff = [
      "+++ b/src/cli.ts",
      "+++ b/test/cli.test.ts",
      "+++ b/tests/unit/test_promote.py",
      "+++ b/.swarm/scratch/x.test.ts",
    ].join("\n");
    expect(testsTouched(diff)).toEqual(["test/cli.test.ts", "tests/unit/test_promote.py"]);
  });
});

describe("a failing check in one line", () => {
  // ironroot (Arm B, 2026-11-06): pytest's summary was followed by a pytest-asyncio deprecation
  // warning, the last 1,800 bytes held only the warning and two assertion reprs, so the model never
  // read "falsification.py still defines _falsify_chain_seq_monotonic", and the stop named the
  // warning, whose "unexpected" read as "expected".
  it("keeps the runner's failure summary in what the model reads, whatever follows it", async () => {
    const output = await readFile(
      join(import.meta.dirname, "fixtures", "ironroot-held-out-2026-11-06.txt"),
      "utf8",
    );
    const shown = excerpt(output);
    expect(shown).toContain(
      "FAILED tests/integrity/test_builtin_claims_held_out.py::test_falsification_no_longer_defines_them - AssertionError: falsification.py still defines _falsify_chain_seq_monotonic",
    );
    expect(shown.length).toBeLessThanOrEqual(2400);
    expect(failureLine(`the user's check fails:\n${shown}`)).toMatch(
      /^the user's check fails: FAILED tests\/integrity\/test_builtin_claims_held_out\.py::/,
    );
  });

  // t6 (Arm B, rc.4, 2026-11-07): a re-export shim dropped a private name, 8 test modules failed
  // to collect and 72 tests failed downstream. The one line saying why, "cannot import name
  // '_entry_from_dict'", sat under a collection error; three FAILED lines and the tail filled
  // the excerpt, and the model read only symptoms until the quiet stop.
  it("keeps the error a collection failure printed, which no summary line states", async () => {
    const output = await readFile(
      join(import.meta.dirname, "fixtures", "t6-collection-errors-2026-11-07.txt"),
      "utf8",
    );
    const shown = excerpt(output, 1200);
    expect(shown).toContain(
      "E   ImportError: cannot import name '_entry_from_dict' from 'tracemantle.core.history_io'",
    );
    expect(shown.length).toBeLessThanOrEqual(1600);
    expect(shown.match(/cannot import name/g)).toHaveLength(1);
  });

  it("joins its summary to the first output line that names what failed", () => {
    expect(
      failureLine("its authored test fails:\n\n   x\nFAILED tests/a.py::t - assert 4 == 2\nmore"),
    ).toBe("its authored test fails: FAILED tests/a.py::t - assert 4 == 2");
    expect(failureLine("src/a.py lacks x: the file still contains it")).toBe(
      "src/a.py lacks x: the file still contains it",
    );
  });
});

// ironroot (2026-11-05, sealed-set run): the stop named "builtin_claims.py defines ...: holds",
// a claim that held, because the failing ones came after it in the check's detail.
describe("a refactor's claims after a change", () => {
  it("lists the failing claims first, so a stop names one that fails", async () => {
    // Both fail at the base; the copy makes the first hold and leaves the second failing.
    const claims = [
      { path: "lib/half.mjs", contains: "export const half" },
      { path: "half.mjs", contains: "export const half", absent: true },
    ];
    const copy = bash(
      "mkdir -p lib && printf 'export const half = (n) => n / 2;\\n' > lib/half.mjs",
    );
    const model = scripted([copy, bash("ls"), bash("pwd"), bash("ls -a")], {
      author: [`kind: refactor\n\n\`\`\`claims\n${JSON.stringify(claims)}\n\`\`\`\n`],
    });
    const probe = await fixture(
      { "half.mjs": "export const half = (n) => n / 2;\n" },
      "Move half into lib/half.mjs.",
    );
    const ran = await probe.run(model, { maxSteps: 20 });
    expect(ran.report.reason).toMatch(
      /R1 still fails: half\.mjs lacks "export const half": the file still contains it$/,
    );
  });
});
