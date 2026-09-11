import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { parseLedgerText, verifyChain } from "../evidence/ledger.ts";

export async function readSessionEvidence(root: string, runId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("invalid session identity for recovery");
  const directory = join(root, runId);
  const parsed = parseLedgerText(await readFile(join(directory, "ledger.jsonl"), "utf8"));
  if (parsed.problems.length > 0 || !verifyChain(parsed.records).ok)
    throw new Error("recovery ledger does not verify; preserve it and inspect the damaged chain");
  const payloads = new Map<string, Record<string, unknown>>();
  for (const record of parsed.records) {
    const bytes = await readFile(
      join(directory, "blobs", `${record.payloadDigest.slice(7)}.json`),
      "utf8",
    );
    if (digestOfBytes(bytes) !== record.payloadDigest)
      throw new Error(`recovery payload ${record.sequence} failed its digest check`);
    payloads.set(record.payloadDigest, JSON.parse(bytes));
  }
  return { records: parsed.records, payloads };
}
