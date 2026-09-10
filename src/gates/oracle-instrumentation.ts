import { harnessReportingCommand } from "./harness-reporting.ts";
import { commandWords, shellQuoted } from "./node-test-command.ts";

/**
 * Splits an oracle command into the setup that puts its test file in place and a final test run
 * the harness can rebuild under coverage.
 *
 * A real oracle is a compound shell string: `mkdir … && cp … && node --test …`. Vouching the whole
 * string fails, so reach came back `unmeasured` on koa#1946, which is the case the reach check
 * exists for. The setup is the harness's own mkdir and cp, so only the last segment matters.
 *
 * Nothing here predicts what a shell will do with a command. The final segment is rebuilt through
 * the same vouching the ratchet uses, and anything it cannot express as an argv it controls is
 * refused rather than corrected into something that looks close enough.
 */
export interface InstrumentedOracle {
  /** Everything before the final command, run as the shell string it already was. */
  readonly setup: string;
  /** The final test run, rebuilt as an argv the harness controls, with coverage on. */
  readonly argv: readonly string[];
}

/**
 * Whether a shell, rather than this code, decides what the segment runs.
 *
 * Read outside quotes only. A title filter joins case names with a regex alternation, so the pipe
 * arrives inside single quotes where a shell reads it as a character; refusing the segment for
 * containing one refuses every real oracle, which is what left reach unmeasured on the case the
 * check was written for.
 */
function shellDecidesIt(segment: string): boolean {
  let quote: string | null = null;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index] as string;
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if ("|;&<>`$(){}".includes(character)) return true;
  }
  return false;
}

export function instrumentedOracle(command: string): InstrumentedOracle | null {
  const segments = command.split("&&");
  if (segments.length === 0) {
    return null;
  }
  const last = segments.at(-1)?.trim() ?? "";
  if (last.length === 0 || shellDecidesIt(last)) {
    return null;
  }
  const argv = harnessReportingCommand(last);
  if (argv === null) {
    return null;
  }
  return { setup: segments.slice(0, -1).join("&&").trim(), argv };
}

/**
 * Which runner the final segment starts, or null where this cannot say.
 *
 * Recognized completely or not at all, the same rule the vouching uses: a runner nobody
 * recognized gets no flags invented for it and reach abstains. A package-manager wrapper in front
 * is read through, because that is how every repository in the corpus invokes a local binary.
 */
const wrapperPrograms: ReadonlySet<string> = new Set(["npx", "pnpm", "yarn", "bunx"]);

type CoverageRunner = "node" | "mocha" | "jest" | "vitest";

const runnerPrograms: ReadonlySet<string> = new Set(["node", "mocha", "jest", "vitest"]);

function runnerStartedBy(words: readonly string[]): CoverageRunner | null {
  const program = words[0];
  if (program === undefined) {
    return null;
  }
  if (runnerPrograms.has(program)) {
    return program as CoverageRunner;
  }
  if (!wrapperPrograms.has(program)) {
    return null;
  }
  // One word past the wrapper, and only one: `npx --yes jest` and `pnpm exec jest` are the same
  // invocation to a reader and not to this, which is why anything else abstains.
  const wrapped = words[1];
  return wrapped !== undefined && runnerPrograms.has(wrapped) ? (wrapped as CoverageRunner) : null;
}

/**
 * How to make an oracle report the lines it ran, or null where nothing here can.
 *
 * Reach used to accept one answer, node's own runner rebuilt as a vouched argv, which is
 * invariant 7's rule for an artifact the ratchet reads. It is the wrong rule here and the cost
 * was measurable: four of the seventeen mined repositories use node's runner and the other
 * thirteen were blind. The ratchet's bar exists because the workspace can author a number a retry
 * is judged against; reach only ever turns a green into a refusal, so a forged report buys
 * `reached`, which is exactly what an unmeasured oracle already gets. The residual is real and
 * stays named here and in docs/beta-gates.md: these reports are written by the workspace's own
 * processes and nothing here detects a forged one.
 *
 * Three arms, in the order they are preferred:
 *
 *   - node's own lcov reporter, where the harness can rebuild the invocation. Unchanged, because
 *     it is the arm every reach verdict on the corpus so far was measured by;
 *   - V8's own coverage, for a runner that loads the file as written. The offsets are positions
 *     in what V8 compiled, so they address the file itself and need nothing but the file;
 *   - the runner's own lcov report, for jest and vitest, which transform before they run. A
 *     command-line coverage setting overrides the project's configuration in both.
 */
export type OracleCoveragePlan =
  | { readonly kind: "node-lcov"; readonly setup: string; readonly argv: readonly string[] }
  | {
      readonly kind: "v8";
      readonly setup: string;
      readonly command: string;
      readonly destination: string;
    }
  | {
      readonly kind: "lcov-file";
      readonly setup: string;
      readonly command: string;
      readonly file: string;
    };

export function oracleCoveragePlan(
  command: string,
  destination: string,
): OracleCoveragePlan | null {
  const segments = command.split("&&");
  const last = segments.at(-1)?.trim() ?? "";
  if (last.length === 0 || shellDecidesIt(last)) {
    return null;
  }
  const setup = segments.slice(0, -1).join("&&").trim();

  const asNodeRunner = harnessReportingCommand(last);
  if (asNodeRunner !== null) {
    return { kind: "node-lcov", setup, argv: asNodeRunner };
  }

  const words = commandWords(last);
  if (words === null) {
    return null;
  }
  const runner = runnerStartedBy(words);
  if (runner === null) {
    return null;
  }
  // The destination reaches a shell as part of the command, so it is quoted the way any other
  // path this harness hands to one is, and a path that cannot be quoted abstains rather than
  // being escaped into something close enough.
  const quotedDestination = shellQuoted(destination);
  if (quotedDestination === null) {
    return null;
  }

  if (runner === "jest") {
    return {
      kind: "lcov-file",
      setup,
      command: `${last} --coverage --coverageDirectory=${quotedDestination} --coverageReporters=lcovonly`,
      file: `${destination}/lcov.info`,
    };
  }
  if (runner === "vitest") {
    return {
      kind: "lcov-file",
      setup,
      command: `${last} --coverage.enabled --coverage.reportsDirectory=${quotedDestination} --coverage.reporter=lcovonly`,
      file: `${destination}/lcov.info`,
    };
  }
  return { kind: "v8", setup, command: last, destination };
}
