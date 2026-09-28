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

/**
 * The per-test outcomes of a structured report, or null where it is not a complete one. A title
 * repeated in one file is named by its occurrence, as src/gates/runner-results.ts names it.
 */
function structuredPoints(observation) {
  if (observation.outputTruncated || (observation.stdout ?? "").length > 4000000) return null;
  try {
    const report = JSON.parse(observation.stdout);
    let tests;
    if (report.schema === "swarm.pytest.v1") {
      if (!Array.isArray(report.tests) || report.tests.length > 100000) return null;
      tests = report.tests;
    } else {
      for (const field of ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests"])
        if (!Number.isInteger(report[field]) || report[field] < 0) return null;
      tests = report.testResults.flatMap((file) => {
        if (typeof file.name !== "string") throw new Error("file absent");
        const seen = new Map();
        return file.assertionResults.map((test) => {
          if (
            typeof test.fullName !== "string" ||
            !["passed", "failed", "pending", "skipped", "todo"].includes(test.status)
          )
            throw new Error("invalid point");
          const count = (seen.get(test.fullName) ?? 0) + 1;
          seen.set(test.fullName, count);
          return {
            id: `${file.name}:${test.fullName}${count === 1 ? "" : `#${count}`}`,
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
        return null;
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
      return null;
    return tests;
  } catch {
    return null;
  }
}

/** Structured results carry outcomes, never extra ratchet authority. */
function structuredTestStatus(observation) {
  const tests = structuredPoints(observation);
  if (tests === null)
    return observation.outputTruncated || (observation.stdout ?? "").length > 4000000
      ? "not-applicable"
      : observation.exitCode === 0
        ? "not-applicable"
        : "failed";
  const executed = tests.filter((test) => test.status !== "skipped");
  if (!executed.length) return "not-applicable";
  return observation.exitCode !== 0 || executed.some((test) => test.status !== "passed")
    ? "failed"
    : "passed";
}

/**
 * The tests a run names as failed and passed, from a structured report or TAP; null where it
 * names none. Mirrors src/gates/failure-attribution.ts, written again here so a record is judged
 * by a second implementation rather than by the code that produced it.
 */
function namedTests(observation) {
  const stdout = observation.stdout ?? "";
  if (stdout.trimStart().startsWith("{")) {
    const points = structuredPoints(observation);
    if (points === null) return null;
    return {
      failed: points.filter((p) => p.status === "failed" || p.status === "error").map((p) => p.id),
      passed: points.filter((p) => p.status === "passed").map((p) => p.id),
    };
  }
  const text = `${stdout}\n${observation.stderr ?? ""}`;
  if (!/^TAP version \d+/m.test(text)) {
    // Vitest's text reporters name every failure on a FAIL line beside their Test Files summary.
    const plain = text
      .split(escapeCharacter)
      .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-9;]*[A-Za-z]/, "")))
      .join("");
    const summary = /^\s*Test Files\s+(.+)$/m.exec(plain)?.[1];
    if (summary === undefined) return null;
    const failed = [];
    for (const line of plain.split("\n")) {
      const named = /^\s*FAIL\s+(\S.*?)\s*$/.exec(line)?.[1];
      if (named && !failed.includes(named)) failed.push(named);
    }
    if (failed.length === 0 && /\d+\s+failed/.test(summary)) return null;
    return { failed, passed: [] };
  }
  const failed = [];
  const passed = [];
  for (const line of text.split("\n")) {
    const point = /^(\s*)(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/.exec(line);
    if (point === null) continue;
    if (/#\s*(TODO|SKIP)\b/i.test(point[3])) continue;
    const id = `${point[1].length}:${point[3].replace(/\s+#.*$/, "")}`;
    (point[2] === "ok" ? passed : failed).push(id);
  }
  return { failed, passed };
}

const escapeCharacter = String.fromCharCode(27);

function comparableOutput(observation) {
  return `${observation.exitCode}\n${observation.stdout ?? ""}\n${observation.stderr ?? ""}`
    .split(escapeCharacter)
    .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-9;]*[A-Za-z]/, "")))
    .join("")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<timestamp>")
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "<clock>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min)\b/g, "<duration>")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

/** Why a failed reading failed, from it and the base's reading of the same check. */
function attribution(failing, parser, baseObservation) {
  if (baseObservation === undefined || readStatus(parser, baseObservation) !== "failed")
    return { attribution: "new", newFailures: [] };
  const patched = namedTests(failing);
  const base = namedTests(baseObservation);
  if (patched !== null && base !== null && patched.failed.length > 0) {
    const newFailures = patched.failed.filter((id) => !base.failed.includes(id));
    return newFailures.length === 0
      ? { attribution: "inherited", newFailures: [] }
      : { attribution: "new", newFailures };
  }
  return comparableOutput(failing) === comparableOutput(baseObservation)
    ? { attribution: "inherited", newFailures: [] }
    : { attribution: "unattributed", newFailures: [] };
}

/** The status a check must carry given its own, base-configuration and base readings. */
function expectedStatus(check) {
  const own = readStatus(check.parser, check.observation);
  if (check.configurationObservation === undefined) return { status: own, regressed: [] };
  const underBase = readStatus(check.parser, check.configurationObservation);
  if (underBase !== check.configurationStatus) return null;
  if (own !== "passed" || underBase === "passed") return { status: own, regressed: [] };
  const points = namedTests(check.configurationObservation);
  const base = check.baseObservation === undefined ? null : namedTests(check.baseObservation);
  const regressed =
    points === null || base === null
      ? []
      : points.failed.filter((id) => base.passed.includes(id) && !base.failed.includes(id));
  return {
    status: underBase === "failed" && regressed.length > 0 ? "failed" : "not-applicable",
    regressed,
  };
}

const sameList = (a, b) => JSON.stringify([...(a ?? [])]) === JSON.stringify([...(b ?? [])]);

/**
 * Derive new captured-check results; undefined preserves older aggregate-only records.
 *
 * A record that carries `attribution` or a base-configuration reading is judged by the rule that
 * wrote them: every failed check's attribution is recomputed from its readings and must match,
 * a check the patch's runner configuration alone passed must carry the status the base's
 * configuration decides, and only a proven inherited failure is left out of the dimension. A
 * record without them is judged by the rule it was written under, which read any failure the base
 * shared as inherited and left the dimension unmeasured. Records from 1.0.3 to 1.0.5 that read
 * such a failure as a regression pass do not re-derive, and should not: that pass was not shown.
 */
export function capturedRegression(checks) {
  if (!Array.isArray(checks) || !checks.some((check) => check.observation !== undefined))
    return undefined;
  try {
    const attributed = checks.some(
      (check) => check.attribution !== undefined || check.configurationObservation !== undefined,
    );
    for (const check of checks) {
      if (
        check.observation === undefined ||
        typeof check.id !== "string" ||
        !["passed", "failed", "not-applicable"].includes(check.status) ||
        (check.optionalAbsence !== undefined && typeof check.optionalAbsence !== "boolean") ||
        (check.optionalAbsence === true &&
          (check.status !== "not-applicable" ||
            typeof check.observation.unavailable !== "string" ||
            check.observation.exitCode !== 0 ||
            check.observation.stdout !== "" ||
            check.observation.stderr !== "")) ||
        !["blocking", "advisory"].includes(check.severity)
      )
        return null;
      const expected = expectedStatus(check);
      if (expected === null || expected.status !== check.status) return null;
      if (
        check.configurationObservation !== undefined &&
        !sameList(expected.regressed, check.regressedUnderBaseConfiguration ?? [])
      )
        return null;
      if (!attributed) {
        if (
          check.inheritedFromBase === true &&
          (!check.baseObservation || readStatus(check.parser, check.baseObservation) !== "failed")
        )
          return null;
        continue;
      }
      if (check.status !== "failed") {
        if (check.attribution !== undefined || check.inheritedFromBase === true) return null;
        continue;
      }
      const failing =
        (check.regressedUnderBaseConfiguration ?? []).length > 0
          ? check.configurationObservation
          : check.observation;
      const derived = attribution(failing, check.parser, check.baseObservation);
      if (
        derived.attribution !== check.attribution ||
        (check.inheritedFromBase === true) !== (derived.attribution === "inherited") ||
        !sameList(derived.newFailures, check.newFailures ?? [])
      )
        return null;
    }
    const inherited = (check) =>
      check.status === "failed" &&
      (attributed ? check.attribution === "inherited" : check.inheritedFromBase === true);
    if (
      checks.some(
        (check) =>
          check.status === "failed" &&
          !inherited(check) &&
          !(attributed && check.attribution === "unattributed"),
      )
    )
      return "fail";
    if (
      checks.some(
        (check) =>
          check.severity === "blocking" &&
          check.status !== "passed" &&
          check.optionalAbsence !== true &&
          !(attributed && inherited(check)),
      )
    )
      return "unmeasured";
    return checks.some((check) => check.status === "passed") ? "pass" : "unmeasured";
  } catch {
    return null;
  }
}
