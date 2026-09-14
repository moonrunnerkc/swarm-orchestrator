import { access } from "node:fs/promises";
import { join } from "node:path";
import { readSessionEvidence } from "./session-evidence.ts";

/** Discovery never creates a missing chain, and an existing damaged chain is never treated as absent. */
export async function controllerSessionId(root: string, runId: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("invalid controller identity for recovery");
  const sessionId = `${runId}-queue`;
  try {
    await access(join(root, sessionId, "ledger.jsonl"));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    try {
      await access(join(root, sessionId));
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw missing;
    }
    throw new Error(
      "controller directory exists without its journal; preserve it and reconcile missing history",
    );
  }
  const captured = await readSessionEvidence(root, sessionId);
  if (
    !captured.records.some(
      (record) => record.type === "controller-launch" || record.type === "controller-configuration",
    )
  )
    throw new Error(
      "parallel history predates recoverable controller inputs; preserve its branches and inspect the session",
    );
  return sessionId;
}
