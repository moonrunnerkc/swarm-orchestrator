import { expect, it } from "vitest";
import { capturedRegression } from "../evidence/verifier/status.mjs";
import {
  attributeFailure,
  attributionRule,
  testPoints,
  unattributedReason,
  withoutTemporaryNames,
} from "./failure-attribution.ts";

/**
 * Vitest's text reporters, as a project script with flags the structured runner does not take
 * prints them (cronproof's `vitest run --coverage --reporter=verbose`): the coverage table
 * differs between the base and the patch whenever the patch changes code, so the outputs never
 * match, and the FAIL lines are what name the failures.
 */
const vitestText = (failing: readonly string[], coverage: string) => ({
  exitCode: 1,
  stdout: [
    " RUN  v4.1.10 /workspace",
    "",
    ...failing.map((name) => ` × ${name} 3ms`),
    "",
    ` Failed Tests ${failing.length}`,
    "",
    ...failing.map((name) => ` FAIL  test/cron.test.ts > ${name}`),
    "AssertionError: expected 1 to be 2",
    "",
    ` Test Files  1 failed | 4 passed (5)`,
    `      Tests  ${failing.length} failed | 40 passed (${40 + failing.length})`,
    "   Duration  1.52s",
    "",
    " % Coverage report from v8",
    `All files |   ${coverage} |`,
  ].join("\n"),
  stderr: "",
  durationMs: 1,
  unavailable: null,
});

it("names Vitest's text-reporter failures, and never a pass, beside its summary", () => {
  expect(testPoints(vitestText(["zone > spring forward"], "91.2"))).toEqual({
    failed: ["test/cron.test.ts > zone > spring forward"],
    passed: [],
    causes: { "test/cron.test.ts > zone > spring forward": "AssertionError: expected 1 to be 2" },
    complete: true,
  });
  expect(testPoints({ ...vitestText([], "91.2"), stdout: "no summary here" })).toBeNull();
});

it("proves an inheritance across a coverage table that moved, and names a new failure", () => {
  const base = vitestText(["zone > spring forward"], "91.2");
  expect(
    attributeFailure({
      withPatch: vitestText(["zone > spring forward"], "92.8"),
      baseStatus: "failed",
      atBase: base,
    }).attribution,
  ).toBe("inherited");
  expect(
    attributeFailure({
      withPatch: vitestText(["zone > spring forward", "parse > step"], "92.8"),
      baseStatus: "failed",
      atBase: base,
    }),
  ).toEqual({ attribution: "new", newFailures: ["test/cron.test.ts > parse > step"] });
});

it("reads the same attribution in the offline re-deriver", () => {
  const check = (withPatch: ReturnType<typeof vitestText>, attribution: string) => ({
    id: "tests",
    parser: "test-output",
    severity: "blocking",
    status: "failed",
    observation: withPatch,
    baseObservation: vitestText(["zone > spring forward"], "91.2"),
    attribution,
    inheritedFromBase: attribution === "inherited",
  });
  const lint = {
    id: "lint",
    parser: "exit-code",
    severity: "blocking",
    status: "passed",
    observation: { exitCode: 0, stdout: "", stderr: "", unavailable: null },
  };
  expect(
    capturedRegression([lint, check(vitestText(["zone > spring forward"], "92.8"), "inherited")]),
  ).toBe("pass");
  expect(
    capturedRegression([
      lint,
      check(vitestText(["zone > spring forward", "parse > step"], "92.8"), "inherited"),
    ]),
  ).toBeNull();
});

/** Node's TAP for a list of points, each `[verdict, depth, title, location, error]`. */
function tap(
  points: readonly (readonly [string, number, string, string | null, string?])[],
  counters: { fail?: number; cancelled?: number; plan?: boolean } = {},
) {
  const lines = ["TAP version 13"];
  let number = 0;
  for (const [verdict, depth, title, location, error] of points) {
    const pad = " ".repeat(depth);
    number++;
    lines.push(`${pad}# Subtest: ${title}`, `${pad}${verdict} ${number} - ${title}`, `${pad}  ---`);
    lines.push(`${pad}  duration_ms: ${(number * 1.37).toFixed(3)}`, `${pad}  type: 'test'`);
    if (location !== null) lines.push(`${pad}  location: '/checkout/${location}'`);
    if (verdict === "not ok")
      lines.push(
        `${pad}  failureType: 'testCodeFailure'`,
        `${pad}  error: '${error ?? "1 !== 2"}'`,
        `${pad}  code: 'ERR_ASSERTION'`,
      );
    lines.push(`${pad}  ...`);
  }
  const failing = points.filter(([verdict]) => verdict === "not ok").length;
  if (counters.plan !== false) lines.push(`1..${points.length}`);
  lines.push(
    `# tests ${points.length}`,
    `# pass ${points.length - failing}`,
    `# fail ${counters.fail ?? failing}`,
  );
  lines.push(`# cancelled ${counters.cancelled ?? 0}`);
  return { exitCode: 1, stdout: lines.join("\n"), stderr: "", durationMs: 1, unavailable: null };
}

type Point = readonly [string, number, string, string | null, string?];

function both(withPatch: ReturnType<typeof tap>, atBase: ReturnType<typeof tap>) {
  const live = attributeFailure({ withPatch, baseStatus: "failed", atBase });
  const check = {
    id: "tests",
    parser: "test-output",
    severity: "blocking",
    status: "failed",
    observation: withPatch,
    baseObservation: atBase,
    attribution: live.attribution,
    attributionRule,
    inheritedFromBase: live.attribution === "inherited",
    ...(live.newFailures.length === 0 ? {} : { newFailures: live.newFailures }),
  };
  // The offline reader recomputes the same attribution and so accepts the record.
  expect(capturedRegression([check])).toBe(
    live.attribution === "inherited"
      ? "unmeasured"
      : live.attribution === "new"
        ? "fail"
        : "unmeasured",
  );
  expect(
    capturedRegression([
      { ...check, attribution: live.attribution === "new" ? "inherited" : "new" },
    ]),
  ).toBeNull();
  return live;
}

const aFails: Point = ["not ok", 0, "works", "a.test.mjs:3:1"];
const bPasses: Point = ["ok", 0, "works", null];
const bFails: Point = ["not ok", 0, "works", "b.test.mjs:4:1"];

it("tells same-titled tests in two files apart, and keeps a comment-only change inherited", () => {
  expect(both(tap([aFails, bFails]), tap([aFails, bPasses]))).toEqual({
    attribution: "new",
    newFailures: ["b.test.mjs:4:1 › 0:works"],
  });
  expect(both(tap([aFails, bPasses]), tap([aFails, bPasses])).attribution).toBe("inherited");
});

it("tells same-titled tests in two nested suites apart", () => {
  const suite = (name: string, verdict: string, line: number): Point[] => [
    [verdict, 4, "works", verdict === "not ok" ? `s.test.mjs:${line}:3` : null],
    [
      verdict,
      0,
      name,
      verdict === "not ok" ? `s.test.mjs:${line - 1}:1` : null,
      "1 subtest failed",
    ],
  ];
  const base = tap([...suite("A", "not ok", 2), ...suite("B", "ok", 5)], { fail: 1 });
  const patched = tap([...suite("A", "not ok", 2), ...suite("B", "not ok", 5)], { fail: 2 });
  const live = both(patched, base);
  expect(live.attribution).toBe("new");
  expect(live.newFailures).toContain("s.test.mjs:5:3 › 4:works");
});

it("reads results in another order as the same failures", () => {
  expect(both(tap([bPasses, aFails]), tap([aFails, bPasses])).attribution).toBe("inherited");
});

it("counts a failure repeated under one identity, and never inherits a repeated identity", () => {
  const loop: Point = ["not ok", 0, "case", "l.test.mjs:2:3"];
  expect(both(tap([loop, loop]), tap([loop])).attribution).toBe("new");
  expect(both(tap([loop, loop]), tap([loop, loop])).attribution).toBe("unattributed");
});

it("does not inherit a failure whose cause changed, or from a run that did not report completely", () => {
  const other: Point = ["not ok", 0, "works", "a.test.mjs:3:1", "3 !== 2"];
  expect(both(tap([other, bPasses]), tap([aFails, bPasses])).attribution).toBe("unattributed");
  expect(both(tap([aFails, bPasses], { cancelled: 1 }), tap([aFails, bPasses])).attribution).toBe(
    "unattributed",
  );
  expect(both(tap([aFails, bPasses], { fail: 2 }), tap([aFails, bPasses])).attribution).toBe(
    "unattributed",
  );
  expect(both(tap([aFails, bPasses], { plan: false }), tap([aFails, bPasses])).attribution).toBe(
    "unattributed",
  );
  const truncated = { ...tap([aFails, bPasses]), outputTruncated: true };
  expect(
    attributeFailure({ withPatch: truncated, baseStatus: "failed", atBase: tap([aFails, bPasses]) })
      .attribution,
  ).toBe("unattributed");
});

it("keeps judging a record written before failure-identity v2 by the title-only rule it was written under", () => {
  const withPatch = tap([aFails, bFails]);
  const atBase = tap([aFails, bPasses]);
  const legacy = {
    id: "tests",
    parser: "test-output",
    severity: "blocking",
    status: "failed",
    observation: withPatch,
    baseObservation: atBase,
    attribution: "inherited",
    inheritedFromBase: true,
  };
  const lint = {
    id: "lint",
    parser: "exit-code",
    severity: "blocking",
    status: "passed",
    observation: { exitCode: 0, stdout: "", stderr: "", durationMs: 1, unavailable: null },
  };
  // What 1.0.7 recorded re-derives as what 1.0.7 decided; the same bytes under v2 do not.
  expect(capturedRegression([legacy, lint])).toBe("pass");
  expect(
    capturedRegression([{ ...legacy, attributionRule: "failure-identity-v2" }, lint]),
  ).toBeNull();
});

/** Node's spec reporter as Node 24 prints it for a project's own `node --test`. */
function spec(failures: readonly (readonly [string, string, string])[], passes: readonly string[]) {
  const lines = [
    ...passes.map((title) => `✔ ${title} (0.5ms)`),
    ...failures.map(([, title]) => `✖ ${title} (1.0ms)`),
    `ℹ tests ${passes.length + failures.length}`,
    "ℹ suites 0",
    `ℹ pass ${passes.length}`,
    `ℹ fail ${failures.length}`,
    "ℹ cancelled 0",
    "ℹ skipped 0",
    "ℹ duration_ms 300.1",
    "",
    "✖ failing tests:",
    "",
    ...failures.flatMap(([location, title, error]) => [
      `test at ${location}`,
      `✖ ${title} (1.0ms)`,
      `  AssertionError [ERR_ASSERTION]: ${error}`,
      "      at TestContext.<anonymous> (file:///x.mjs:1:1)",
      "",
    ]),
  ];
  return {
    exitCode: failures.length > 0 ? 1 : 0,
    stdout: lines.join("\n"),
    stderr: "",
    durationMs: 1,
    unavailable: null,
  };
}

it("tells same-titled failures apart in Node's spec reporter, as in TAP", () => {
  const base = spec([["a.test.mjs:3:1", "works", "1 !== 2"]], ["works"]);
  const broken = spec(
    [
      ["a.test.mjs:3:1", "works", "1 !== 2"],
      ["b.test.mjs:4:1", "works", "6 !== 4"],
    ],
    [],
  );
  expect(both(broken as never, base as never)).toEqual({
    attribution: "new",
    newFailures: ["b.test.mjs:4:1 › 0:works"],
  });
  expect(both(base as never, base as never).attribution).toBe("inherited");
  const changed = spec([["a.test.mjs:3:1", "works", "3 !== 2"]], ["works"]);
  expect(both(changed as never, base as never).attribution).toBe("unattributed");
});

/**
 * tracemantle's three failures, as its base and its patched run reported them through the
 * harness's pytest runner: the same three ids, and two messages that differ only in the random
 * name of pre-commit's repository directory, which pytest's repr cut to its tail.
 */
function pytestRun(tests: readonly { id: string; status: string; message?: string }[]) {
  return {
    exitCode: 1,
    stdout: `${JSON.stringify({ schema: "swarm.pytest.v1", tests })}\n`,
    stderr: "",
    durationMs: 1,
    unavailable: null,
    outputTruncated: false,
  };
}
const tokenizer =
  "tracemantle.tokenizer.TokenizerError: Cannot load tiktoken cl100k_base. Install tracemantle[tiktoken] and warm its cache, or select --tokenizer heuristic for offline use.";
const preCommit = (expected: number, stage: string, suffix: string) =>
  `AssertionError: assert 3 == ${expected}\n +  where 3 = CompletedProcess(args=['pre-commit', 'run', 'tracemantle', '--all-files'], returncode=3, stdout='[INFO] ${stage} e...epo${suffix}\\' when installing build dependencies\\nCheck the log at /tmp/.cache/pre-commit/pre-commit.log\\n', stderr='').returncode`;
const tracemantle = (suffix: string, passing = "tests.test_cli:test_help") =>
  pytestRun([
    {
      id: "tests.test_build_plan_core:test_explicit_tokenizer_provenance_and_special_markers",
      status: "failed",
      message: tokenizer,
    },
    {
      id: "tests.test_pre_commit:test_pre_commit_pass",
      status: "failed",
      message: preCommit(0, "Initializing", suffix),
    },
    {
      id: "tests.test_pre_commit:test_pre_commit_fail",
      status: "failed",
      message: preCommit(1, "Installing env", suffix),
    },
    { id: passing, status: "passed" },
  ]);

function recorded(withPatch: ReturnType<typeof pytestRun>, atBase: ReturnType<typeof pytestRun>) {
  const live = attributeFailure({ withPatch, baseStatus: "failed", atBase });
  return {
    live,
    check: {
      id: "tests",
      parser: "structured-test-output",
      severity: "blocking",
      status: "failed",
      observation: withPatch,
      baseObservation: atBase,
      attribution: live.attribution,
      attributionRule,
      inheritedFromBase: live.attribution === "inherited",
      ...(live.newFailures.length === 0 ? {} : { newFailures: live.newFailures }),
    },
  };
}

const passingLint = {
  id: "lint",
  parser: "exit-code",
  severity: "blocking",
  status: "passed",
  observation: { exitCode: 0, stdout: "", stderr: "", durationMs: 1, unavailable: null },
};

it("inherits failures that differ only in a temporary directory's random name, in both readers", () => {
  const { live, check } = recorded(tracemantle("nyx5xidu"), tracemantle("c90ac5y6"));
  expect(live).toEqual({ attribution: "inherited", newFailures: [] });
  // The offline re-deriver reads the same attribution from the record, and refuses the other.
  expect(capturedRegression([check, passingLint])).toBe("pass");
  expect(capturedRegression([{ ...check, attribution: "unattributed" }, passingLint])).toBeNull();
});

it("still reads a failure whose message changed as changed", () => {
  const changed = pytestRun([
    ...JSON.parse(tracemantle("nyx5xidu").stdout).tests.slice(0, 2),
    {
      id: "tests.test_pre_commit:test_pre_commit_fail",
      status: "failed",
      message: preCommit(2, "Installing env", "nyx5xidu"),
    },
  ]);
  const { live, check } = recorded(changed, tracemantle("c90ac5y6"));
  expect(live.attribution).toBe("unattributed");
  expect(capturedRegression([check, passingLint])).toBe("unmeasured");
  expect(unattributedReason(changed, tracemantle("c90ac5y6"))).toContain(
    "the same tests fail at the base, but for a different reason (tests.test_pre_commit:test_pre_commit_fail)",
  );
});

it("keeps a meaningful difference in a path, and sets aside only generated temporary names", () => {
  // Generated: the directory mkdtemp made, under each platform's temporary root.
  expect(withoutTemporaryNames("at /tmp/pytest-of-root/tmpk3j_2x9a/out.json")).toBe(
    withoutTemporaryNames("at /tmp/pytest-of-root/tmpq8vb01zz/out.json"),
  );
  expect(
    withoutTemporaryNames("/private/var/folders/1q/2_tt_q51x/T/swarm-verify-2vP2VA/a.log"),
  ).toBe(withoutTemporaryNames("/var/folders/7z/9yyk_0b3/T/swarm-verify-G3uTQs/a.log"));
  expect(withoutTemporaryNames("C:\\Users\\ci\\AppData\\Local\\Temp\\jest_a1b2c3\\x.snap")).toBe(
    withoutTemporaryNames("C:\\Users\\runner\\AppData\\Local\\Temp\\jest_z9y8x7\\x.snap"),
  );
  // Kept: a path outside a temporary root, a file's own name, a directory named without a digit,
  // and a message.
  expect(withoutTemporaryNames("at /workspace/src/parser1.py:3")).not.toBe(
    withoutTemporaryNames("at /workspace/src/parser2.py:3"),
  );
  expect(withoutTemporaryNames("wrote /tmp/cache/report_v10001.json")).not.toBe(
    withoutTemporaryNames("wrote /tmp/cache/report_v20002.json"),
  );
  expect(withoutTemporaryNames("/tmp/fixtures_alpha/data.json")).not.toBe(
    withoutTemporaryNames("/tmp/fixtures_bravo/data.json"),
  );
  expect(withoutTemporaryNames("expected 'abc123' got 'abc124'")).not.toBe(
    withoutTemporaryNames("expected 'abc123' got 'abc125'"),
  );
  // An elided value's tail is set aside only where it has a generated name's shape.
  expect(withoutTemporaryNames("e...eponyx5xidu'")).toBe(withoutTemporaryNames("e...epoc90ac5y6'"));
  expect(withoutTemporaryNames("e...alphabet'")).not.toBe(withoutTemporaryNames("e...alphabeu'"));
});

it("keeps a record written under failure-identity v2 judged by v2, temporary names and all", () => {
  const { check } = recorded(tracemantle("nyx5xidu"), tracemantle("c90ac5y6"));
  const legacy = { ...check, attributionRule: "failure-identity-v2" };
  // v2 compared causes byte for byte: what 1.2.0 recorded as unattributed re-derives as that.
  expect(
    capturedRegression([
      { ...legacy, attribution: "unattributed", inheritedFromBase: false },
      passingLint,
    ]),
  ).toBe("unmeasured");
  expect(capturedRegression([legacy, passingLint])).toBeNull();
});

it("names the tests an unattributed check's output does name", () => {
  expect(unattributedReason(tracemantle("nyx5xidu"), undefined)).toBe(
    "the base could not be put in place to run it",
  );
  const plain = { exitCode: 1, stdout: "boom", stderr: "", durationMs: 1, unavailable: null };
  expect(unattributedReason(plain, { ...plain, stdout: "bang" })).toBe(
    "its output names no tests to compare and differs from the base's",
  );
});

/**
 * Vitest's JSON as the harness's runner prints it. quantproof's base control ran all 637 tests,
 * failed none, and exited 1 when a worker aborted on exit inside better-sqlite3 under Node 24; the
 * file that worker was running reported its seven tests pending, so the totals did not reconcile.
 */
function vitestRun(
  files: Readonly<Record<string, Readonly<Record<string, string>>>>,
  exitCode: number,
  totals: { pending?: number } = {},
) {
  const testResults = Object.entries(files).map(([name, tests]) => ({
    name,
    assertionResults: Object.entries(tests).map(([fullName, status]) => ({
      fullName,
      status,
      ...(status === "failed" ? { failureMessages: [`AssertionError: ${fullName}`] } : {}),
    })),
  }));
  const all = testResults.flatMap((file) => file.assertionResults);
  return {
    exitCode,
    stdout: JSON.stringify({
      numTotalTests: all.length,
      numPassedTests: all.filter((one) => one.status === "passed").length,
      numFailedTests: all.filter((one) => one.status === "failed").length,
      numPendingTests: totals.pending ?? 0,
      testResults,
    }),
    stderr: "",
    durationMs: 1,
    unavailable: null,
    outputTruncated: false,
  };
}

const scorer = "tests/scoring/numeric-tolerance-scorer.test.ts";
const store = "tests/store/sqlite-store.test.ts";
const crashedBase = vitestRun(
  {
    [scorer]: { "passes within relative tolerance": "passed", "reports both values": "passed" },
    [store]: { "writes a run": "pending", "reads it back": "pending" },
  },
  1,
);
const brokenHead = vitestRun(
  {
    [scorer]: { "passes within relative tolerance": "failed", "reports both values": "failed" },
    [store]: { "writes a run": "passed", "reads it back": "passed" },
  },
  1,
);

function vitestRecord(
  withPatch: ReturnType<typeof vitestRun>,
  atBase: ReturnType<typeof vitestRun>,
) {
  const live = attributeFailure({ withPatch, baseStatus: "failed", atBase });
  return {
    live,
    check: {
      id: "tests",
      parser: "structured-test-output",
      severity: "blocking",
      status: "failed",
      observation: withPatch,
      baseObservation: atBase,
      attribution: live.attribution,
      attributionRule,
      inheritedFromBase: live.attribution === "inherited",
      ...(live.newFailures.length === 0 ? {} : { newFailures: live.newFailures }),
    },
  };
}

it("reads tests the crashed base named passing, and the patch fails, as newly failing", () => {
  expect(testPoints(crashedBase)).toBeNull();
  const { live, check } = vitestRecord(brokenHead, crashedBase);
  expect(live).toEqual({
    attribution: "new",
    newFailures: [`${scorer}:passes within relative tolerance`, `${scorer}:reports both values`],
  });
  // The offline reader derives the same regression from the record, and refuses another reading.
  expect(capturedRegression([check, passingLint])).toBe("fail");
  expect(capturedRegression([{ ...check, attribution: "unattributed" }, passingLint])).toBeNull();
  // Under v2, which 1.2.0 wrote, the same bytes read unattributed, as recorded then.
  expect(
    capturedRegression([
      {
        ...check,
        attributionRule: "failure-identity-v2",
        attribution: "unattributed",
        newFailures: undefined,
      },
      passingLint,
    ]),
  ).toBe("unmeasured");
});

it("never makes a crash into a pass or into evidence the base did not give", () => {
  // A failure in a test the crashed base never finished is not shown new, and nothing is inherited.
  const failsWhereTheBaseStopped = vitestRun(
    {
      [scorer]: { "passes within relative tolerance": "passed", "reports both values": "passed" },
      [store]: { "writes a run": "failed", "reads it back": "passed" },
    },
    1,
  );
  expect(vitestRecord(failsWhereTheBaseStopped, crashedBase).live.attribution).toBe("unattributed");
  const { check } = vitestRecord(failsWhereTheBaseStopped, crashedBase);
  expect(capturedRegression([check, passingLint])).toBe("unmeasured");
  // A base the harness killed at its deadline (exit 128) proves nothing, whatever it printed.
  expect(vitestRecord(brokenHead, { ...crashedBase, exitCode: 128 }).live.attribution).toBe(
    "unattributed",
  );
  // A base that names a failure of its own is not a crash after completion.
  const failingBase = vitestRun(
    {
      [scorer]: { "passes within relative tolerance": "passed", "reports both values": "passed" },
      [store]: { "writes a run": "failed", "reads it back": "pending" },
    },
    1,
  );
  expect(vitestRecord(brokenHead, failingBase).live.attribution).toBe("unattributed");
  // A cut report is never read.
  expect(vitestRecord(brokenHead, { ...crashedBase, outputTruncated: true }).live.attribution).toBe(
    "unattributed",
  );
});
