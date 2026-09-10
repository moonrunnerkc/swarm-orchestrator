/**
 * The invocation that runs exactly one half of a mined pull request's test cases.
 *
 * Both oracles are the same file run with a different title filter, rather than two files carved
 * out of one. Carving means reconstructing imports, setup and the enclosing `describe` blocks
 * around a subset of cases, and a reconstruction that does not parse refuses every patch for a
 * reason that has nothing to do with the patch.
 *
 * Neither oracle is ever placed in the workspace the model works in. Both are copied into the
 * verification checkout at judging time, which is what keeps the held-back half held back: a
 * model that can read the file can satisfy it.
 */
export type TestRunner = "jest" | "vitest" | "mocha" | "ava" | "node";

/** A title as a regex that matches it and nothing near it. */
function asPattern(title: string): string {
  return title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The selector that runs exactly these titles, or null where the runner has no spelling for it.
 *
 * Null rather than the widest filter that parses. ava matches by glob and has no alternation, so
 * several titles used to become `--match '*'`, which selects every case in the file: both halves
 * then run the whole suite, the sealed oracle and the held-back oracle become the same check, and
 * they agree on every patch by construction. A pair of oracles that cannot disagree measures
 * reproducibility and reports it as a false-green rate, which is the mistake the withdrawn 0-of-18
 * number was made of. No ava task has been mined yet; this is the runner arriving before the
 * corpus does.
 */
export function titleFilterFor(
  runner: TestRunner,
  titles: readonly string[],
): readonly string[] | null {
  const pattern = titles.map(asPattern).join("|");
  switch (runner) {
    case "jest":
    case "vitest":
      return ["-t", pattern];
    case "mocha":
      return ["--grep", pattern];
    case "ava":
      return titles.length === 1 ? ["--match", titles[0] ?? ""] : null;
    case "node":
      return ["--test-name-pattern", pattern];
  }
}

/**
 * A shell command that puts the pull request's test file in place and runs one half of its cases.
 * Shaped like the real-repository oracles so both corpora are judged by the same kind of thing.
 */
/**
 * Single-quoted for a POSIX shell, with an embedded quote closed and reopened around an escaped
 * one. `JSON.stringify` was doing this job and is the wrong tool: it is JSON quoting, it leaves
 * `$` and a backtick alone, and koa's real test title `ctx.assert.${method}() should throw ...`
 * expanded to `ctx.assert.() should throw ...`, which matches no test. A title is prose somebody
 * else wrote, and it reaches a shell.
 */
function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function oracleCommand(input: {
  storedTestFile: string;
  destination: string;
  runner: TestRunner;
  runnerArgv: readonly string[];
  titles: readonly string[];
}): string | null {
  const selector = titleFilterFor(input.runner, input.titles);
  if (selector === null) {
    return null;
  }
  const filter = selector.map(shellQuoted);
  // Before the file, not after it. `node --test` stops reading flags at the first positional
  // argument, so a filter appended to the end is silently ignored and the file runs whole:
  // measured on a three-test file, 3 ran with the filter after and 1 with it before. Both halves
  // of a split are the same file under a different filter, so an ignored filter makes the sealed
  // and the held-back oracle identical and they agree by construction, which is the self-agreement
  // the withdrawn 0-of-18 number was made of. Every other runner accepts flags in either place.
  const beforeTheFile = [...input.runnerArgv];
  const file = beforeTheFile.pop();
  const invocation = [
    ...beforeTheFile,
    ...filter,
    ...(file === undefined ? [] : [shellQuoted(file)]),
  ].join(" ");
  const destination = shellQuoted(input.destination);
  return (
    `mkdir -p "$(dirname ${destination})" && ` +
    `cp ${shellQuoted(input.storedTestFile)} ${destination} && ` +
    `${invocation}`
  );
}

/**
 * Whether a held-back oracle's refusal is about the patch rather than about being run alone.
 *
 * Splitting one suite in two assumes its tests are independent, and plenty are not. winston's
 * container tests share state through the container itself: the held-back half passed with the
 * sealed half beside it and failed on its own, so the oracle refused a patch that was fine and the
 * pass recorded a false green. A false green is the most consequential thing this measures, so it
 * is the last place to accept a result that has not been told apart from its artifact.
 *
 * The discriminator costs one extra run: a half that fails alone and passes in company was never
 * refusing anything, it was missing its setup.
 */
export function heldBackRefusalIsReal(input: {
  aloneFailed: boolean;
  togetherFailed: boolean;
}): boolean {
  return input.aloneFailed && input.togetherFailed;
}

/**
 * Whether the sealed oracle is capable of distinguishing the work from no work.
 *
 * A sealed half that passes on the base source accepts a patch that changes nothing, so the tool's
 * `task: accepted` establishes nothing and a false green resting on it is an artifact rather than
 * a finding. winston#2181 was published as a false green and withdrawn for this reason: its sealed
 * case asserted that a class is exported, and it was exported before the patch.
 *
 * The viability filter requires the whole added test file to fail on the base. It does not require
 * it of each half, and the halves are what the oracles run, so a file can qualify while the half
 * handed to the tool is vacuous.
 */
export function sealedOracleTestsThePatch(input: { sealedFailedOnBase: boolean }): boolean {
  return input.sealedFailedOnBase;
}
