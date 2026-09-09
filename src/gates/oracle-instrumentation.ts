import { harnessReportingCommand } from "./harness-reporting.ts";

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
