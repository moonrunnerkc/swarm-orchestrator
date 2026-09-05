import type { LoopEvent } from "./core/loop-events.ts";
import type { RunVerdict } from "./evidence/verdict.ts";

/**
 * Line-delimited JSON, so a CI job or another agent reads a run without scraping the text a
 * person reads. Two shapes: an event as it happens, and one result at the end. Both carry a
 * schema name, because a consumer that cannot tell which shape it is reading has to guess, and
 * guessing is how a machine interface breaks without anyone noticing.
 */
export const eventSchemaName = "swarm.event.v1";
export const resultSchemaName = "swarm.result.v1";

/**
 * What the process exits with, as a taxonomy rather than "zero or not". A caller that has to
 * tell a failing gate from a run that could not start is otherwise reading stderr.
 */
export const exitCodes = {
  /** Every blocking gate passed, no policy gate failed, and something executed the change. */
  acceptable: 0,
  /** The run finished and what it produced was not acceptable. */
  notAcceptable: 1,
  /** The command line, the configuration, or the workspace was wrong. Nothing ran. */
  invalidRequest: 2,
  /** A person or a supervisor stopped it, or it hit its wall budget. */
  cancelled: 3,
  /** The run could not proceed: no model, no runtime, no repository. */
  unavailable: 4,
  /** The harness itself failed. A bug here, not in the work. */
  internalError: 5,
} as const;

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

export function jsonEventLine(event: LoopEvent, context: { readonly runId: string }): string {
  return JSON.stringify({
    schema: eventSchemaName,
    runId: context.runId,
    at: undefined,
    event,
  });
}

export interface MachineResult {
  readonly runId: string;
  /** Null where the run never reached a verdict, which is itself the answer. */
  readonly verdict: RunVerdict | null;
  readonly bundleDirectory: string | null;
  readonly exitCode: number;
}

export function jsonResultLine(result: MachineResult): string {
  return JSON.stringify({
    schema: resultSchemaName,
    runId: result.runId,
    verdict: result.verdict,
    bundleDirectory: result.bundleDirectory,
    exitCode: result.exitCode,
  });
}
