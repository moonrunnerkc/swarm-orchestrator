/** Independent behavior assertion derivation from sealed definitions and raw observations. */
export function behaviorStatus(check, observed) {
  if (!check || !observed || observed.unavailable !== null || observed.outputTruncated === true)
    return "unjudged";
  const matches = (text, assertions) =>
    typeof text === "string" &&
    Array.isArray(assertions) &&
    assertions.every((assertion) =>
      assertion.kind === "equals"
        ? text === assertion.value
        : assertion.kind === "contains" && text.includes(assertion.value),
    );
  if (check.kind === "cli")
    return observed.exitCode === check.exitCode &&
      matches(observed.stdout, check.stdout) &&
      matches(observed.stderr, check.stderr)
      ? "accepted"
      : "rejected";
  if (observed.exitCode !== 0) return "rejected";
  try {
    const result = JSON.parse(observed.stdout);
    if (check.kind === "http") {
      if (result.unavailable !== null || result.truncated) return "unjudged";
      let json = true;
      if (check.json.length) {
        const body = JSON.parse(result.body);
        json = check.json.every((assertion) => {
          let value = body;
          for (const key of assertion.path)
            value =
              value !== null && typeof value === "object" && Object.hasOwn(value, key)
                ? value[key]
                : undefined;
          return value === assertion.equals;
        });
      }
      return result.failure === undefined &&
        result.status === check.status &&
        Object.entries(check.headers).every(([key, value]) => result.headers?.[key] === value) &&
        matches(result.body ?? "", check.body) &&
        json
        ? "accepted"
        : "rejected";
    }
    if (
      check.kind !== "browser" ||
      !result.stats ||
      !Array.isArray(result.errors) ||
      !Array.isArray(result.suites)
    )
      return "unjudged";
    const points = [];
    const visit = (groups, depth) => {
      if (!Array.isArray(groups) || depth > 32 || points.length > 100000)
        throw Error("invalid suites");
      for (const group of groups) {
        if (!Array.isArray(group.specs)) throw Error("missing specs");
        for (const spec of group.specs) {
          if (
            typeof spec.id !== "string" ||
            !spec.id ||
            !Array.isArray(spec.tests) ||
            !spec.tests.length
          )
            throw Error("invalid spec");
          for (const test of spec.tests) {
            if (
              typeof test.projectName !== "string" ||
              !Array.isArray(test.results) ||
              !test.results.length ||
              test.expectedStatus !== "passed"
            )
              throw Error("invalid test");
            points.push({ id: `${spec.id}:${test.projectName}`, test });
          }
        }
        visit(group.suites ?? [], depth + 1);
      }
    };
    visit(result.suites, 0);
    if (new Set(points.map((point) => point.id)).size !== points.length) return "unjudged";
    const count = (status) => points.filter((point) => point.test.status === status).length;
    for (const [field, status] of [
      ["expected", "expected"],
      ["unexpected", "unexpected"],
      ["flaky", "flaky"],
      ["skipped", "skipped"],
    ])
      if (result.stats[field] !== count(status)) return "unjudged";
    return points.length === check.expectedTests &&
      result.errors.length === 0 &&
      points.every(
        ({ test }) =>
          test.status === "expected" &&
          test.results.length === 1 &&
          test.results[0].status === "passed" &&
          Array.isArray(test.results[0].errors) &&
          test.results[0].errors.length === 0,
      )
      ? "accepted"
      : "rejected";
  } catch {
    return "unjudged";
  }
}
