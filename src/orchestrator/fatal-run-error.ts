import type { FatalAgentError } from '../adapters/fatal-error-classifier';

/**
 * Thrown when an agent CLI reports an unrecoverable, account-level failure
 * (usage-limit, auth, extended rate-limit). The orchestrator catches this
 * and aborts the run instead of replanning into the same wall.
 *
 * Distinct from a verification failure: those are step-level signals that
 * the agent produced a wrong patch, and the replan/repair loop can usefully
 * try again. A FatalRunError signals that *no* further agent invocations
 * will succeed for this run, so retrying would only burn more wall-clock
 * for the same outcome.
 *
 * The contained `cause` carries the classifier verdict (kind + evidence)
 * so postmortem reports and the SWE-bench harness can attribute the abort
 * to the specific account-level wall that triggered it.
 */
export class FatalRunError extends Error {
  readonly fatalKind: FatalAgentError['kind'];
  readonly evidence: string;
  readonly stepNumber: number | undefined;
  readonly agentName: string | undefined;

  constructor(
    fatal: FatalAgentError,
    context: { stepNumber?: number; agentName?: string } = {},
  ) {
    const where = context.stepNumber !== undefined
      ? ` (step ${context.stepNumber}${context.agentName ? `, ${context.agentName}` : ''})`
      : '';
    super(
      `agent CLI reported unrecoverable ${fatal.kind} error${where}: ${fatal.message}. ` +
      `Aborting run; replanning cannot recover from an account-level wall. ` +
      `Resolve the upstream issue (upgrade plan, refresh credentials, wait through the rate-limit window) and rerun.`,
    );
    this.name = 'FatalRunError';
    this.fatalKind = fatal.kind;
    this.evidence = fatal.evidence;
    this.stepNumber = context.stepNumber;
    this.agentName = context.agentName;
  }
}

export function isFatalRunError(err: unknown): err is FatalRunError {
  return err instanceof FatalRunError
    || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'FatalRunError');
}
