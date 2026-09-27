import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * A bounded copy of what a run produced, for upload. The original session stays append-only
 * where it was written; this is the reader's copy, with an inventory naming every file that
 * was and was not retained, so a truncated upload is visible as one rather than mistaken for
 * the whole.
 */
export interface RetentionInventory {
  readonly path: string;
  readonly bytes?: number;
  readonly digest?: string;
  readonly retained: boolean;
  readonly reason?: string;
}

export interface Retention {
  readonly destination: string;
  readonly complete: boolean;
  readonly inventory: readonly RetentionInventory[];
}

const byteLimit = 32_000_000;
const fileByteLimit = 8_000_000;
const fileLimit = 4096;
const depthLimit = 8;

/** Copy the named entries of `directory` under `directory/retained`, within the bounds. */
export function retainActionArtifacts(
  directory: string,
  names: readonly string[] = [
    "bundle",
    "report.json",
    "summary.md",
    "verdict.json",
    "attestation",
    "diagnostic.txt",
  ],
): Retention {
  const destination = join(directory, "retained");
  mkdirSync(destination, { mode: 0o700, recursive: true });
  const inventory: RetentionInventory[] = [];
  let remaining = byteLimit;
  let complete = true;
  const visit = (path: string, relative: string, depth: number): void => {
    if (depth > depthLimit || inventory.length >= fileLimit) {
      complete = false;
      return;
    }
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      mkdirSync(join(destination, relative), { recursive: true, mode: 0o700 });
      for (const name of readdirSync(path))
        visit(join(path, name), join(relative, name), depth + 1);
    } else if (stat.isFile() && stat.size <= fileByteLimit && stat.size <= remaining) {
      const bytes = readFileSync(path);
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      copyFileSync(path, join(destination, relative));
      remaining -= bytes.length;
      inventory.push({ path: relative, bytes: bytes.length, digest, retained: true });
    } else {
      complete = false;
      inventory.push({
        path: relative,
        bytes: stat.size,
        retained: false,
        reason: "retention bound or unsupported file type",
      });
    }
  };
  for (const name of names) {
    try {
      lstatSync(join(directory, name));
    } catch {
      continue;
    }
    try {
      visit(join(directory, name), name, 0);
    } catch (cause) {
      complete = false;
      inventory.push({
        path: name,
        retained: false,
        reason: (cause as { code?: string }).code ?? "copy failed",
      });
    }
  }
  writeFileSync(
    join(destination, "retention.json"),
    JSON.stringify({ version: 1, complete, byteLimit, fileLimit, inventory }, null, 2),
    { mode: 0o600 },
  );
  return { destination, complete, inventory };
}
