function notApplicable(observation) {
  if (observation.unavailable !== null && observation.unavailable !== undefined)
    return "not-applicable";
  if (observation.exitCode === 127) return "not-applicable";
  return null;
}

function counter(text, name) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp - name is one of the counter names this file calls with, never input. Mirrors src/gates/parsers.ts.
  const found = new RegExp(`^[#ℹ]\\s+${name}\\s+(\\d+)\\s*$`, "m").exec(text)?.[1];
  return found === undefined ? null : Number(found);
}

/**
 * The status the named parser rule reads out of an observation. Mirrors src/gates/parsers.ts
 * and src/gates/default-gates.ts, rule for rule; the parity test in that tree holds the two
 * to each other.
 */
export function readStatus(parser, observation) {
  const unavailable = notApplicable(observation);
  if (unavailable !== null) return unavailable;
  const stdout = observation.stdout ?? "";
  const stderr = observation.stderr ?? "";
  switch (parser) {
    case "exit-code":
      return observation.exitCode === 0 ? "passed" : "failed";
    case "no-output":
      if (observation.exitCode !== 0) return "failed";
      return stdout.trim().length === 0 ? "passed" : "failed";
    case "inspection":
      try {
        JSON.parse(stdout);
      } catch {
        return "failed";
      }
      return observation.exitCode === 0 ? "passed" : "failed";
    case "structured-test-output":
      return structuredTestStatus(observation);
    case "test-output": {
      if (stdout.trimStart().startsWith("{")) return structuredTestStatus(observation);
      const text = `${stdout}\n${stderr}`;
      if (/^TAP version \d+/m.test(text) || counter(text, "tests") !== null) {
        const plan = /^\s*1\.\.(\d+)\s*$/m.exec(text)?.[1];
        const tests = counter(text, "tests") ?? (plan === undefined ? null : Number(plan));
        const fail = counter(text, "fail");
        const failed = observation.exitCode !== 0 || (fail ?? 0) > 0;
        if (!failed && tests === 0) return "not-applicable";
        return failed ? "failed" : "passed";
      }
      const summary = /^\s*Tests\s+(.+?)\s*$/m.exec(text)?.[1] ?? "";
      if (/\(\d+\)/.test(summary)) {
        const failedCount = /(\d+)\s+failed/.exec(summary)?.[1];
        const failed = observation.exitCode !== 0 || Number(failedCount ?? 0) > 0;
        return failed ? "failed" : "passed";
      }
      return observation.exitCode === 0 ? "passed" : "failed";
    }
    default:
      return null;
  }
}

/** Structured results carry outcomes, never extra ratchet authority. */
function structuredTestStatus(observation) {
  if (observation.outputTruncated || observation.stdout.length > 4000000) return "not-applicable";
  try {
    const report = JSON.parse(observation.stdout);
    let tests;
    if (report.schema === "swarm.pytest.v1") {
      if (!Array.isArray(report.tests) || report.tests.length > 100000)
        throw new Error("tests absent");
      tests = report.tests;
    } else {
      for (const field of ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests"])
        if (!Number.isInteger(report[field]) || report[field] < 0) throw new Error("invalid total");
      tests = report.testResults.flatMap((file) => {
        if (typeof file.name !== "string") throw new Error("file absent");
        return file.assertionResults.map((test) => {
          if (
            typeof test.fullName !== "string" ||
            !["passed", "failed", "pending", "skipped", "todo"].includes(test.status)
          )
            throw new Error("invalid point");
          return {
            id: `${file.name}:${test.fullName}`,
            status: ["passed", "failed"].includes(test.status) ? test.status : "skipped",
          };
        });
      });
      if (
        report.numTotalTests !== tests.length ||
        report.numPassedTests !== tests.filter((test) => test.status === "passed").length ||
        report.numFailedTests !== tests.filter((test) => test.status === "failed").length ||
        report.numPendingTests !== tests.filter((test) => test.status === "skipped").length
      )
        throw new Error("totals disagree");
    }
    if (
      tests.some(
        (test) =>
          typeof test.id !== "string" ||
          !test.id ||
          !["passed", "failed", "skipped", "error"].includes(test.status),
      ) ||
      new Set(tests.map((test) => test.id)).size !== tests.length
    )
      throw new Error("invalid test identity");
    const executed = tests.filter((test) => test.status !== "skipped");
    if (!executed.length) return "not-applicable";
    return observation.exitCode !== 0 || executed.some((test) => test.status !== "passed")
      ? "failed"
      : "passed";
  } catch {
    return observation.exitCode === 0 ? "not-applicable" : "failed";
  }
}

/** Derive new captured-check results; undefined preserves older aggregate-only records. */
export function capturedRegression(checks) {
  if (!Array.isArray(checks) || !checks.some((check) => check.observation !== undefined))
    return undefined;
  try {
    if (
      checks.some(
        (check) =>
          !check.observation ||
          !["blocking", "advisory"].includes(check.severity) ||
          readStatus(check.parser, check.observation) !== check.status ||
          (check.inheritedFromBase === true &&
            (!check.baseObservation ||
              readStatus(check.parser, check.baseObservation) !== "failed")),
      )
    )
      return null;
    if (checks.some((check) => check.status === "failed" && check.inheritedFromBase !== true))
      return "fail";
    if (checks.some((check) => check.severity === "blocking" && check.status !== "passed"))
      return "unmeasured";
    return checks.some((check) => check.status === "passed") ? "pass" : "unmeasured";
  } catch {
    return null;
  }
}
