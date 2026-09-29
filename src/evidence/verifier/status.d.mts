/** Independent parser outcome for captured process output. */
export function readStatus(
  parser: unknown,
  observation: unknown,
): "passed" | "failed" | "not-applicable" | null;
/** Independently derived new regression, unknown input, or a legacy aggregate. */
export function capturedRegression(
  checks: unknown,
): "pass" | "fail" | "unmeasured" | null | undefined;
/** What makes a recorded instrument-identity-v1 observation untrusted; empty where nothing does. */
export function instrumentChanges(instrument: unknown): readonly string[];
