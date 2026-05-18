/**
 * Base error class for all swarm-orchestrator errors.
 *
 * Every domain-specific error in the project extends this class so that
 * callers can branch on `instanceof SwarmError` to handle any
 * orchestrator-specific failure uniformly, or drill into `.code` for
 * machine-readable dispatch.
 */
export class SwarmError extends Error {
  readonly code: string;
  readonly remediation?: string;

  constructor(message: string, code: string, options?: { remediation?: string; cause?: unknown }) {
    const errorOptions: ErrorOptions | undefined = options?.cause !== undefined
      ? { cause: options.cause }
      : undefined;
    super(message, errorOptions);
    this.name = 'SwarmError';
    this.code = code;
    if (options?.remediation !== undefined) {
      this.remediation = options.remediation;
    }
  }
}