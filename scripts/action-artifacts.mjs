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

/** Keep a bounded artifact copy while leaving the original append-only session intact. */
export function retainActionArtifacts(directory) {
  const destination = join(directory, "retained");
  mkdirSync(destination, { mode: 0o700 });
  const inventory = [];
  let remaining = 32_000_000,
    complete = true;
  const visit = (path, relative, depth) => {
    if (depth > 8 || inventory.length >= 4096) {
      complete = false;
      return;
    }
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      mkdirSync(join(destination, relative), { recursive: true, mode: 0o700 });
      for (const name of readdirSync(path))
        visit(join(path, name), join(relative, name), depth + 1);
    } else if (stat.isFile() && stat.size <= 8_000_000 && stat.size <= remaining) {
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
  for (const name of ["bundle", "report.json", "summary.md", "diagnostic.txt"]) {
    try {
      visit(join(directory, name), name, 0);
    } catch (cause) {
      complete = false;
      inventory.push({ path: name, retained: false, reason: cause.code ?? "copy failed" });
    }
  }
  writeFileSync(
    join(destination, "retention.json"),
    JSON.stringify(
      { version: 1, complete, byteLimit: 32_000_000, fileLimit: 4096, inventory },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return { destination, complete };
}
