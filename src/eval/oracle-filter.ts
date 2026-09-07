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

export function titleFilterFor(runner: TestRunner, titles: readonly string[]): readonly string[] {
  const pattern = titles.map(asPattern).join("|");
  switch (runner) {
    case "jest":
    case "vitest":
      return ["-t", pattern];
    case "mocha":
      return ["--grep", pattern];
    case "ava":
      return ["--match", titles.length === 1 ? (titles[0] ?? "") : `*`];
    case "node":
      return ["--test-name-pattern", pattern];
  }
}

/**
 * A shell command that puts the pull request's test file in place and runs one half of its cases.
 * Shaped like the real-repository oracles so both corpora are judged by the same kind of thing.
 */
export function oracleCommand(input: {
  storedTestFile: string;
  destination: string;
  runner: TestRunner;
  runnerArgv: readonly string[];
  titles: readonly string[];
}): string {
  const filter = titleFilterFor(input.runner, input.titles).map((one) => JSON.stringify(one));
  // Before the file, not after it. `node --test` stops reading flags at the first positional
  // argument, so a filter appended to the end is silently ignored and the file runs whole:
  // measured on a three-test file, 3 ran with the filter after and 1 with it before. Both halves
  // of a split are the same file under a different filter, so an ignored filter makes the sealed
  // and the held-back oracle identical and they agree by construction, which is the self-agreement
  // the withdrawn 0-of-18 number was made of. Every other runner accepts flags in either place.
  const beforeTheFile = [...input.runnerArgv];
  const file = beforeTheFile.pop();
  const invocation = [...beforeTheFile, ...filter, ...(file === undefined ? [] : [file])].join(" ");
  return (
    `mkdir -p "$(dirname ${input.destination})" && ` +
    `cp ${JSON.stringify(input.storedTestFile)} ${input.destination} && ` +
    `${invocation}`
  );
}
