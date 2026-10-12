/**
 * The harness is part of the frozen protocol: what it sends each arm, how it supervises and how
 * it scores are code in this directory. The manifest carries a digest over that code so that a
 * launch under an edited harness is refused instead of silently recorded beside launches made
 * under the frozen one. Tests are excluded; they do not run during a launch.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function harnessDigest(directory = import.meta.dirname) {
  const hash = createHash("sha256");
  for (const name of readdirSync(directory)
    .filter((one) => one.endsWith(".mjs") && !one.endsWith(".test.mjs"))
    .sort()) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(join(directory, name)));
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}
