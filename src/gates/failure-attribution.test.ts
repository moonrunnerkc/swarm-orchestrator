import { expect, it } from "vitest";
import { capturedRegression } from "../evidence/verifier/status.mjs";
import { attributeFailure, testPoints } from "./failure-attribution.ts";

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
    attributionRule: "failure-identity-v2",
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
