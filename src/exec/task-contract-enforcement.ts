import type { EvidenceRecorder } from "../evidence/session.ts";
import type { TaskContract } from "../evidence/task-contract.ts";
import type { ExecutionEnvelope } from "./execution-mode.ts";

/** Capability observations cannot silently relax the policy a caller required. */
export async function enforceContractExecution(
  contract: TaskContract,
  envelope: ExecutionEnvelope,
  evidence: EvidenceRecorder,
): Promise<void> {
  const rejection =
    contract.network === "mediated"
      ? "this backend has no mediated-network capability"
      : contract.network === "denied" && envelope.network !== "denied"
        ? `required network denial was not established (${envelope.network})`
        : contract.execution === "isolated" && envelope.mode !== "isolated"
          ? `required isolation was not established (${envelope.mode})`
          : null;
  await evidence.record({
    type: "task-contract",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      phase: "execution-admission",
      taskId: contract.taskId,
      requested: { network: contract.network, execution: contract.execution ?? "restricted" },
      effective: { backend: envelope.backend, environment: envelope.environmentPolicy },
      observed: { network: envelope.network, execution: envelope.mode },
      admitted: rejection === null,
      reason: rejection,
    },
  });
  if (rejection !== null) {
    throw new Error(
      `task ${contract.taskId} cannot be dispatched: ${rejection}; select a capable backend`,
    );
  }
}
