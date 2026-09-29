import { createHash } from "node:crypto";

function sortedJson(value) {
  return JSON.stringify(value, (_key, inner) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

/**
 * What makes a recorded instrument untrusted (instrument-identity-v1). Mirrors
 * `instrumentChanges` in src/gates/instrument-identity.ts, written again here so the decision a
 * record carries is re-derived from the digests it recorded rather than taken from the run. The
 * closure itself was followed by the harness; this checks what follows from what it recorded.
 */
export function instrumentChanges(instrument) {
  if (
    instrument === null ||
    typeof instrument !== "object" ||
    instrument.rule !== "instrument-identity-v1"
  )
    return ["instrument record under an unknown rule"];
  const changed = [];
  for (const file of instrument.files ?? [])
    if (file.reference !== file.current) changed.push(file.path);
  for (const dependency of instrument.dependencies ?? [])
    if (
      dependency.reference !== dependency.current &&
      dependency.currentSource !== "registry" &&
      dependency.currentSource !== "absent"
    )
      changed.push(`dependency ${dependency.name}`);
  for (const runner of instrument.installed ?? []) {
    if (runner.found === null) continue;
    if (runner.expected !== null && runner.found !== runner.expected)
      changed.push(`installed ${runner.name} ${runner.found} (lockfile ${runner.expected})`);
    if (!runner.linked) changed.push(`installed ${runner.name} executable link`);
  }
  if (instrument.complete !== true) changed.push("instrument closure not followed to its end");
  if (instrument.before !== undefined) {
    const { before: _before, ...rest } = instrument;
    const now = `sha256:${createHash("sha256").update(sortedJson(rest)).digest("hex")}`;
    if (now !== instrument.before) changed.push("the instrument changed while the check ran");
  }
  return changed;
}

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
  const status = readParsedStatus(parser, observation);
  // A pass reported under an instrument the change altered is the project's report, not evidence.
  if (
    status === "passed" &&
    observation.instrument !== undefined &&
    instrumentChanges(observation.instrument).length > 0
  )
    return "not-applicable";
  return status;
}

function readParsedStatus(parser, observation) {
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
        const pass = counter(text, "pass");
        const executed =
          pass ??
          (tests === null
            ? null
            : tests - (counter(text, "skipped") ?? 0) - (counter(text, "todo") ?? 0));
        if (!failed && (tests === 0 || executed === 0)) return "not-applicable";
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
      tests = report.tests.map((test) => ({
        id: test.id,
        status: test.status,
        identity: test.id,
        cause: typeof test.message === "string" ? test.message : "",
      }));
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
            identity: `${file.name}:${test.fullName}`,
            cause: Array.isArray(test.failureMessages) ? test.failureMessages.join("\n") : "",
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
 * The tests a run names as failed and passed, under the title-only identity records were
 * attributed with through 1.0.7 (failure-identity v1). Kept so those records re-derive under the
 * rule that wrote them; it is not a rule new records are judged by, and an inheritance it proves
 * is not re-established by it (SV-24).
 */
function namedTestsV1(observation) {
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
    const plain = stripColour(text);
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

function stripColour(text) {
  return text
    .split(escapeCharacter)
    .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-9;]*[A-Za-z]/, "")))
    .join("");
}

function cause(text) {
  return stripColour(text)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<timestamp>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds)\b/g, "<duration>")
    .trim()
    .slice(0, 2000);
}

/** The directory every TAP failure location in the texts shares. */
function locationRoot(texts) {
  const files = [];
  for (const text of texts)
    for (const line of text.split("\n")) {
      const found = /^\s*location:\s*'([^']+)'\s*$/.exec(line)?.[1];
      if (found !== undefined) files.push(found.replace(/^file:\/\//, "").replace(/:\d+:\d+$/, ""));
    }
  if (files.length === 0) return "";
  let shared = files[0].split("/").slice(0, -1);
  for (const file of files.slice(1)) {
    const parts = file.split("/").slice(0, -1);
    let length = 0;
    while (length < shared.length && shared[length] === parts[length]) length++;
    shared = shared.slice(0, length);
  }
  return shared.length === 0 ? "" : `${shared.join("/")}/`;
}

const causeFields = ["failureType", "error", "code", "name", "expected", "actual", "operator"];

/** Node's TAP read under failure-identity v2: a failure named by its location, depth and title. */
function tapTests(text, truncated, root) {
  const lines = text.split("\n");
  const failed = [];
  const passed = [];
  const causes = {};
  let leafFailures = 0;
  for (let index = 0; index < lines.length; index++) {
    const point = /^(\s*)(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/.exec(lines[index]);
    if (point === null) continue;
    if (/#\s*(TODO|SKIP)\b/i.test(point[3])) continue;
    const depth = point[1].length;
    const title = point[3].replace(/\s+#.*$/, "");
    const yaml = [];
    if (/^\s*---\s*$/.test(lines[index + 1] ?? ""))
      for (
        let inner = index + 2;
        inner < lines.length && !/^\s*\.\.\.\s*$/.test(lines[inner]);
        inner++
      )
        yaml.push(lines[inner]);
    if (point[2] === "ok") {
      passed.push(`${depth}:${title}`);
      continue;
    }
    let location = null;
    let type = null;
    const kept = [];
    let block = null;
    // Keys sit two spaces inside the point; deeper lines belong to the key above them.
    const inner = " ".repeat(depth + 2);
    for (const line of yaml) {
      const key =
        line.startsWith(inner) && line[inner.length] !== " "
          ? /^(\w+):\s*(.*)$/.exec(line.slice(inner.length))
          : null;
      if (key !== null) block = key[1];
      const value = key === null ? null : key[2].replace(/^'(.*)'$/, "$1");
      if (key !== null && key[1] === "location" && location === null)
        location = value.replace(/^file:\/\//, "");
      if (key !== null && key[1] === "type" && type === null) type = value;
      if (block !== null && causeFields.includes(block)) kept.push(line.trim());
    }
    if (type !== "suite") leafFailures++;
    const relative =
      location !== null && root.length > 0 && location.startsWith(root)
        ? location.slice(root.length)
        : location;
    const id = relative === null ? `${depth}:${title}` : `${relative} › ${depth}:${title}`;
    failed.push(id);
    causes[id] = cause(kept.join("\n"));
  }
  const counter = (name) => {
    for (const line of lines) {
      const match = /^[#ℹ]\s+(\w+)\s+(\d+)\s*$/.exec(line);
      if (match !== null && match[1] === name) return Number(match[2]);
    }
    return null;
  };
  const fail = counter("fail");
  const complete =
    !truncated &&
    lines.some((line) => /^1\.\.\d+\s*$/.test(line)) &&
    (counter("cancelled") ?? 0) === 0 &&
    (fail === null || fail === leafFailures);
  return { failed, passed, causes, complete };
}

/** Node's spec reporter under failure-identity v2. Mirrors `specPoints` in failure-attribution.ts. */
function specTests(raw, truncated) {
  const lines = stripColour(raw).split("\n");
  const passed = [];
  const failed = [];
  const causes = {};
  const summary = lines.findIndex((line) => /^\u2716 failing tests:\s*$/.test(line));
  for (let index = 0; index < lines.length; index++) {
    if (summary !== -1 && index >= summary) break;
    const pass = /^(\s*)\u2714 (.+?) \(\d+(?:\.\d+)?ms\)\s*$/.exec(lines[index]);
    if (pass !== null) passed.push(`${pass[1].length}:${pass[2]}`);
  }
  if (summary !== -1)
    for (let index = summary + 1; index < lines.length; index++) {
      const location = /^test at (.+:\d+:\d+)\s*$/.exec(lines[index])?.[1];
      const title = /^\s*\u2716 (.+?) \(\d+(?:\.\d+)?ms\)\s*$/.exec(lines[index + 1] ?? "")?.[1];
      if (location === undefined || title === undefined) continue;
      const kept = [];
      for (let inner = index + 2; inner < lines.length; inner++) {
        if (/^test at /.test(lines[inner])) break;
        if (/^\s+at /.test(lines[inner]) || lines[inner].trim().length === 0) continue;
        kept.push(lines[inner].trim());
      }
      const id = `${location} \u203a 0:${title}`;
      failed.push(id);
      causes[id] = cause(kept.join("\n"));
    }
  const count = (name) => {
    for (const line of lines) {
      const match = /^\u2139\s+(\w+)\s+(\d+)\s*$/.exec(line);
      if (match !== null && match[1] === name) return Number(match[2]);
    }
    return null;
  };
  const fail = count("fail");
  return {
    failed,
    passed,
    causes,
    complete:
      !truncated && fail !== null && fail === failed.length && (count("cancelled") ?? 0) === 0,
  };
}

/** A run's tests under failure-identity v2, or null where it names none. */
function namedTestsV2(observation, sharedRoot) {
  const stdout = observation.stdout ?? "";
  const root = sharedRoot ?? locationRoot([`${stdout}\n${observation.stderr ?? ""}`]);
  if (stdout.trimStart().startsWith("{")) {
    const points = structuredPoints(observation);
    if (points === null) return null;
    const failing = points.filter((p) => p.status === "failed" || p.status === "error");
    const causes = {};
    for (const p of failing) causes[p.identity] = cause(p.cause ?? "");
    return {
      failed: failing.map((p) => p.identity),
      passed: points.filter((p) => p.status === "passed").map((p) => p.identity),
      causes,
      complete: true,
    };
  }
  const text = `${stdout}\n${observation.stderr ?? ""}`;
  if (/^TAP version \d+/m.test(text))
    return tapTests(text, observation.outputTruncated === true, root);
  if (/^\u2716 failing tests:\s*$/m.test(text) || /^\u2139\s+tests\s+\d+\s*$/m.test(text))
    return specTests(text, observation.outputTruncated === true);
  const plain = stripColour(text);
  const summary = /^\s*Test Files\s+(.+)$/m.exec(plain)?.[1];
  if (summary === undefined) return null;
  const lines = plain.split("\n");
  const failed = [];
  const causes = {};
  for (let index = 0; index < lines.length; index++) {
    const named = /^\s*FAIL\s+(\S.*?)\s*$/.exec(lines[index])?.[1];
    if (!named) continue;
    failed.push(named);
    const next = lines.slice(index + 1).find((line) => line.trim().length > 0) ?? "";
    causes[named] = /^\s*FAIL\s/.test(next) ? "" : cause(next);
  }
  if (failed.length === 0 && /\d+\s+failed/.test(summary)) return null;
  const counted = /(\d+)\s+failed/.exec(/^\s*Tests\s+(.+)$/m.exec(plain)?.[1] ?? "")?.[1];
  return {
    failed,
    passed: [],
    causes,
    complete: counted === undefined || Number(counted) <= failed.length,
  };
}

function comparableOutput(observation) {
  return stripColour(
    `${observation.exitCode}\n${observation.stdout ?? ""}\n${observation.stderr ?? ""}`,
  )
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<timestamp>")
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "<clock>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min)\b/g, "<duration>")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

/** Why a failed reading failed under v1: title identities, as sets. */
function attributionV1(failing, parser, baseObservation) {
  if (baseObservation === undefined || readStatus(parser, baseObservation) !== "failed")
    return { attribution: "new", newFailures: [] };
  const patched = namedTestsV1(failing);
  const base = namedTestsV1(baseObservation);
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

function tally(ids) {
  const found = new Map();
  for (const id of ids) found.set(id, (found.get(id) ?? 0) + 1);
  return found;
}

/**
 * Why a failed reading failed under failure-identity v2: identities that tell same-titled tests
 * apart, counted, with their causes, from two complete runs. Mirrors `attributeFailure` in
 * src/gates/failure-attribution.ts.
 */
function attributionV2(failing, parser, baseObservation) {
  if (baseObservation === undefined || readStatus(parser, baseObservation) !== "failed")
    return { attribution: "new", newFailures: [] };
  if (failing.outputTruncated === true || baseObservation.outputTruncated === true)
    return { attribution: "unattributed", newFailures: [] };
  const texts = [failing, baseObservation].map((one) => `${one.stdout ?? ""}\n${one.stderr ?? ""}`);
  const root = texts.every((text) => /^TAP version \d+/m.test(text)) ? locationRoot(texts) : "";
  const patched = namedTestsV2(failing, root);
  const base = namedTestsV2(baseObservation, root);
  if (patched !== null && base !== null && patched.failed.length > 0) {
    const before = tally(base.failed);
    const after = tally(patched.failed);
    const newFailures = [...after]
      .filter(([id, count]) => count > (before.get(id) ?? 0))
      .map(([id]) => id)
      .sort();
    if (newFailures.length > 0) return { attribution: "new", newFailures };
    const repeated = [...after, ...before].some(([, count]) => count > 1);
    const changed = [...after.keys()].some((id) => patched.causes[id] !== base.causes[id]);
    return patched.complete && base.complete && !repeated && !changed
      ? { attribution: "inherited", newFailures: [] }
      : { attribution: "unattributed", newFailures: [] };
  }
  if (patched !== null || base !== null) return { attribution: "unattributed", newFailures: [] };
  return comparableOutput(failing) === comparableOutput(baseObservation)
    ? { attribution: "inherited", newFailures: [] }
    : { attribution: "unattributed", newFailures: [] };
}

/** Why a failed reading failed, under the rule the record names. */
function attribution(check, failing) {
  return check.attributionRule === "failure-identity-v2"
    ? attributionV2(failing, check.parser, check.baseObservation)
    : attributionV1(failing, check.parser, check.baseObservation);
}

/**
 * The status a check must carry given its own, base-configuration, base-tests and base readings.
 * A pass whose base-written tests fail against the patch's source, in a way the base does not
 * fail, is withheld with those tests named. Mirrors `weakenedUnderBaseTests` in
 * src/gates/independent-verification.ts.
 */
function expectedStatus(check) {
  const decided = expectedStatusBeforeTests(check);
  if (decided === null) return null;
  if (check.baseTestsObservation === undefined) return { ...decided, weakened: [] };
  const within = (observation, instrument) =>
    instrument === undefined ? observation : { ...observation, instrument };
  const underTests = readStatus(
    check.parser,
    within(check.baseTestsObservation, check.baseTestsInstrument),
  );
  if (underTests !== check.baseTestsStatus) return null;
  if (decided.status !== "passed" || underTests !== "failed") return { ...decided, weakened: [] };
  const derived = attributionV2(check.baseTestsObservation, check.parser, check.baseObservation);
  if (derived.attribution === "inherited") return { ...decided, weakened: [] };
  const baseFailed =
    check.baseObservation !== undefined &&
    readStatus(check.parser, check.baseObservation) === "failed";
  const weakened = baseFailed
    ? derived.newFailures
    : [...new Set(namedTestsV2(check.baseTestsObservation)?.failed ?? [])].sort();
  return { status: "not-applicable", regressed: decided.regressed, weakened };
}

function expectedStatusBeforeTests(check) {
  const within = (observation, instrument) =>
    instrument === undefined ? observation : { ...observation, instrument };
  const reported = readStatus(check.parser, check.observation);
  const own = readStatus(check.parser, within(check.observation, check.instrument));
  // What the runner said is kept where the instrument rule withheld it, and must be what it said.
  if (own !== reported ? check.reportedStatus !== reported : check.reportedStatus !== undefined)
    return null;
  if (check.configurationObservation === undefined) return { status: own, regressed: [] };
  const underBase = readStatus(
    check.parser,
    within(check.configurationObservation, check.configurationInstrument),
  );
  if (underBase !== check.configurationStatus) return null;
  if (reported !== "passed") return { status: own, regressed: [] };
  // Measured again under the base's instrument and passed there: that reading stands.
  if (underBase === "passed") return { status: "passed", regressed: [] };
  const v2 = check.attributionRule === "failure-identity-v2";
  const points = v2
    ? namedTestsV2(check.configurationObservation)
    : namedTestsV1(check.configurationObservation);
  const base =
    check.baseObservation === undefined
      ? null
      : v2
        ? namedTestsV2(check.baseObservation)
        : namedTestsV1(check.baseObservation);
  const title = (id) => (id.includes(" › ") ? id.slice(id.indexOf(" › ") + 3) : id);
  const regressed =
    points === null || base === null
      ? []
      : v2
        ? points.failed.filter(
            (id) =>
              base.passed.filter((one) => one === id || one === title(id)).length === 1 &&
              !base.failed.some((one) => one === id || title(one) === title(id)),
          )
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
      if (!sameList(expected.weakened, check.weakenedTests ?? [])) return null;
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
      const derived = attribution(check, failing);
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
