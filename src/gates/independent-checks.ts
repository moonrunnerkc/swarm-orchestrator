import { assembleGateSet } from "./engine.ts";
import { unavailableObservation } from "./gate-definition.ts";
import type {
  IndependentCheck,
  IndependentVerificationOptions,
} from "./independent-verification.ts";

/** Capture configured commands and absent language checks without dropping unknown outcomes. */
export async function runChecks(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<readonly IndependentCheck[]> {
  const { gates } = await assembleGateSet({
    workspaceRoot: options.repositoryRoot,
    criteriaRef: options.baseCommit,
    ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
  });

  const results: IndependentCheck[] = [];
  for (const gate of gates) {
    if (gate.source.kind === "inspection" && gate.source.unavailableReason === undefined) continue;
    const observed =
      gate.source.kind === "inspection"
        ? unavailableObservation(gate.source.unavailableReason ?? "check unavailable")
        : gate.source.argv === undefined
          ? await options.commands.run(gate.source.command, { cwd: checkout, timeoutMs })
          : await options.commands.runVouched(gate.source.argv, { cwd: checkout, timeoutMs });
    const reading = gate.parse(observed);
    results.push({
      id: gate.id,
      ...(gate.source.kind === "inspection" && gate.source.optionalAbsence === true
        ? { optionalAbsence: true }
        : {}),
      status: reading.status,
      detail: reading.detail,
      severity: gate.severity,
      parser: gate.parserName ?? "exit-code",
      observation: observed,
    });
  }
  return results;
}
