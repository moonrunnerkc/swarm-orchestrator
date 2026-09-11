import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { genesisHash, hashOfRecord, ledgerRecordSchema } from "./ledger-record.ts";

/** A second writer must refuse rather than append a competing branch to the same chain. */
export async function appendLedgerLine(path: string, line: string): Promise<void> {
  const lock = `${path}.lock`;
  if (existsSync(lock)) {
    const owner = Number(readFileSync(lock, "utf8"));
    if (Number.isSafeInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ESRCH") unlinkSync(lock);
      }
    }
  }
  writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  try {
    const recorded = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (recorded !== "" && !recorded.endsWith("\n"))
      throw new Error("ledger has an incomplete tail; preserve it and reconcile before appending");
    const last = recorded.trimEnd().split("\n").at(-1);
    const previous = last ? ledgerRecordSchema.parse(JSON.parse(last)) : null;
    const next = ledgerRecordSchema.parse(JSON.parse(line));
    if (
      next.previousHash !== (previous === null ? genesisHash : hashOfRecord(previous)) ||
      next.sequence !== (previous === null ? 0 : previous.sequence + 1)
    )
      throw new Error(
        "ledger changed since this writer opened it; reopen the session after its current writer finishes",
      );
    const descriptor = openSync(path, "a", 0o600);
    try {
      const bytes = Buffer.from(`${line}\n`);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  } finally {
    unlinkSync(lock);
  }
}
