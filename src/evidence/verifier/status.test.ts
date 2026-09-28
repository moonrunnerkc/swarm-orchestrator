import { expect, it } from "vitest";
import { rederiveCiVerdict } from "./rederive.mjs";
import { capturedRegression } from "./status.mjs";

const passed = {
  id: "build",
  parser: "exit-code",
  severity: "blocking",
  status: "passed",
  observation: { exitCode: 0, stdout: "", stderr: "", unavailable: null },
};
const unmeasured = {
  id: "tests",
  parser: "structured-test-output",
  severity: "blocking",
  status: "not-applicable",
  observation: { exitCode: 0, stdout: "{}", stderr: "", unavailable: null },
};

it("rejects a passing summary when captured required tests produced no usable result", () => {
  expect(capturedRegression([passed, unmeasured])).toBe("unmeasured");
  expect(
    rederiveCiVerdict({
      regression: "pass",
      task: "accepted",
      oracleReach: "reached",
      oracleBond: "held",
      checks: [passed, unmeasured],
    }).verified,
  ).toBeNull();
});

it("rejects a forged parsed status and requires captured base failure attribution", () => {
  expect(capturedRegression([{ ...unmeasured, status: "passed" }])).toBeNull();
  const failed = {
    ...passed,
    status: "failed",
    observation: { ...passed.observation, exitCode: 1 },
  };
  expect(capturedRegression([failed])).toBe("fail");
  expect(capturedRegression([{ ...failed, inheritedFromBase: true }])).toBeNull();
  expect(
    capturedRegression([
      passed,
      {
        ...failed,
        inheritedFromBase: true,
        baseObservation: failed.observation,
      },
    ]),
  ).toBe("unmeasured");
});

it("retains aggregate-only historical semantics and accepts complete captured results", () => {
  expect(capturedRegression([{ id: "tests", status: "passed" }])).toBeUndefined();
  expect(capturedRegression([passed])).toBe("pass");
  expect(capturedRegression([passed, { ...unmeasured, severity: "advisory" }])).toBe("pass");
});

it("retains optional unconfigured tooling without waiving configured missing checks", () => {
  const absent = {
    id: "format:package",
    severity: "blocking",
    parser: "exit-code",
    optionalAbsence: true,
    status: "not-applicable",
    observation: { exitCode: 0, stdout: "", stderr: "", unavailable: "no formatter configured" },
  };
  expect(capturedRegression([passed, absent])).toBe("pass");
  expect(capturedRegression([absent])).toBe("unmeasured");
  expect(capturedRegression([passed, { ...absent, optionalAbsence: undefined }])).toBe(
    "unmeasured",
  );
  expect(
    capturedRegression([
      passed,
      { ...absent, observation: { ...absent.observation, exitCode: 127 } },
    ]),
  ).toBeNull();
  expect(
    capturedRegression([
      passed,
      { ...absent, observation: { ...absent.observation, stdout: '{"optionalAbsence":true}' } },
    ]),
  ).toBeNull();
});

const tap = (points: readonly [string, boolean][], exitCode: number) => ({
  exitCode,
  stdout: [
    "TAP version 13",
    ...points.map(([name, ok], index) => `${ok ? "ok" : "not ok"} ${index + 1} - ${name}`),
    `1..${points.length}`,
    `# tests ${points.length}`,
    `# pass ${points.filter(([, ok]) => ok).length}`,
    `# fail ${points.filter(([, ok]) => !ok).length}`,
  ].join("\n"),
  stderr: "",
  unavailable: null,
});
const tests = (observation: ReturnType<typeof tap>, extra: Record<string, unknown> = {}) => ({
  id: "tests",
  parser: "test-output",
  severity: "blocking",
  status: observation.exitCode === 0 ? "passed" : "failed",
  observation,
  ...extra,
});
const baseWithOldFailure = tap(
  [
    ["old", false],
    ["sum", true],
  ],
  1,
);

it("re-derives a newly broken test behind an old failure as a regression, and refuses a record calling it inherited", () => {
  const head = tap(
    [
      ["old", false],
      ["sum", false],
    ],
    1,
  );
  const honest = tests(head, {
    attribution: "new",
    inheritedFromBase: false,
    newFailures: ["0:sum"],
    baseObservation: baseWithOldFailure,
  });
  expect(capturedRegression([passed, honest])).toBe("fail");
  expect(
    capturedRegression([
      passed,
      { ...honest, attribution: "inherited", inheritedFromBase: true, newFailures: undefined },
    ]),
  ).toBeNull();
});

it("passes only a proven inheritance, and leaves an incomparable one unmeasured", () => {
  const same = tests(
    tap(
      [
        ["old", false],
        ["sum", true],
      ],
      1,
    ),
    {
      attribution: "inherited",
      inheritedFromBase: true,
      baseObservation: baseWithOldFailure,
    },
  );
  expect(capturedRegression([passed, same])).toBe("pass");
  const lint = (stdout: string) => ({ exitCode: 1, stdout, stderr: "", unavailable: null });
  const changed = {
    ...passed,
    id: "lint",
    status: "failed",
    observation: lint("2 problems"),
    baseObservation: lint("1 problem"),
    attribution: "unattributed",
    inheritedFromBase: false,
  };
  expect(capturedRegression([passed, changed])).toBe("unmeasured");
  expect(
    capturedRegression([passed, { ...changed, attribution: "inherited", inheritedFromBase: true }]),
  ).toBeNull();
  const timed = {
    ...changed,
    observation: lint("1 problem (0.4s)"),
    baseObservation: lint("1 problem (0.2s)"),
    attribution: "inherited",
    inheritedFromBase: true,
  };
  expect(capturedRegression([passed, timed])).toBe("pass");
});

it("re-derives a check that passed only under the patch's runner configuration", () => {
  const forged = tap([["sum", true]], 0);
  const underBase = tap([["sum", false]], 1);
  const base = tap([["sum", true]], 0);
  const decided = tests(forged, {
    status: "failed",
    configurationObservation: underBase,
    configurationStatus: "failed",
    configurationFiles: ["vitest.config.mjs"],
    regressedUnderBaseConfiguration: ["0:sum"],
    baseObservation: base,
    attribution: "new",
    inheritedFromBase: false,
  });
  expect(capturedRegression([decided])).toBe("fail");
  expect(
    capturedRegression([
      {
        ...decided,
        status: "passed",
        regressedUnderBaseConfiguration: undefined,
        attribution: undefined,
        inheritedFromBase: undefined,
      },
    ]),
  ).toBeNull();
});

it("keeps the rule a record was written under where it carries no attribution", () => {
  const legacy = tests(
    tap(
      [
        ["old", false],
        ["sum", false],
      ],
      1,
    ),
    {
      inheritedFromBase: true,
      baseObservation: baseWithOldFailure,
    },
  );
  expect(capturedRegression([passed, legacy])).toBe("unmeasured");
});
