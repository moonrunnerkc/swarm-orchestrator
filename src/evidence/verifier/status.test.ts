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
