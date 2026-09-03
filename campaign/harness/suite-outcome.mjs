/**
 * What a suite run said, read as one of four outcomes. A seed is accepted only where the
 * suite goes from passed to test-failure: a build failure is not a defect the tests found,
 * it is a tree the tests could not run over, and an unknown failure is not attributed
 * either way. The markers are per runner and are a fixed list, so a runner this list does
 * not know produces unknown-failure rather than a guess.
 */

const buildFailureMarkers = {
  node: [/SyntaxError/, /Cannot find module/, /ReferenceError/, /error TS\d+/, /TS\d{4}:/],
  python: [/ImportError/, /ModuleNotFoundError/, /SyntaxError/, /IndentationError/, /INTERNALERROR/],
  go: [/\[build failed\]/, /cannot find package/, /^# .+\n.+: (undefined|syntax error)/m, /: undefined:/],
  // cargo ends a genuine test failure with "error: test failed, to rerun pass ...", so a
  // bare "error:" is not a build marker here: only a compiler diagnostic or a failed build is.
  rust: [/^error\[E\d+\]/m, /could not compile/, /^error: could not/m, /^error: failed to/m],
};

const testFailureMarkers = {
  node: [/^not ok /m, /✖/, /\b\d+ failing\b/, /Tests:\s+\d+ failed/, /\b\d+ failed\b/, /^# fail [1-9]/m],
  python: [/\b\d+ failed\b/, /^FAILED /m],
  go: [/^--- FAIL:/m, /^FAIL\s/m],
  rust: [/test result: FAILED/, /panicked at/],
};

export const outcomes = Object.freeze(["passed", "test-failure", "build-failure", "unknown-failure"]);

export function classifySuiteRun(type, exitCode, output) {
  if (exitCode === 0) {
    return "passed";
  }
  const build = buildFailureMarkers[type];
  const test = testFailureMarkers[type];
  if (build === undefined || test === undefined) {
    throw new Error(`no suite markers are known for ${type}`);
  }
  if (type === "python" && exitCode === 2) {
    return "build-failure";
  }
  if (build.some((marker) => marker.test(output))) {
    return "build-failure";
  }
  if (test.some((marker) => marker.test(output))) {
    return "test-failure";
  }
  return "unknown-failure";
}
