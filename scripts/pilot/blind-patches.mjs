/**
 * Blinds the final patches of a published stage for the review rubric: each patch is copied
 * under a letter drawn from a seeded shuffle, with the task named and the arm withheld, and the
 * key is written beside them for unblinding after the scores are recorded. The rubric itself
 * is applied by a reader, not here.
 *
 *   node scripts/pilot/blind-patches.mjs --evidence <stage dir> --out <dir> [--seed <text>]
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const evidence = args.get("evidence");
const out = args.get("out");
if (!evidence || !out) {
  console.error("usage: blind-patches.mjs --evidence <stage dir> --out <dir> [--seed <text>]");
  process.exit(2);
}
const seed = args.get("seed") ?? "blind-review-2026-10-15";
const patches = readdirSync(join(evidence, "patches"))
  .filter((name) => name.endsWith(".patch"))
  .sort();
const ordered = [...patches].sort((a, b) => {
  const ha = createHash("sha256").update(`${seed}:${a}`).digest("hex");
  const hb = createHash("sha256").update(`${seed}:${b}`).digest("hex");
  return ha < hb ? -1 : ha > hb ? 1 : 0;
});
mkdirSync(out, { recursive: true });
const key = [];
ordered.forEach((name, index) => {
  const letter = String.fromCharCode(65 + index);
  const task = name.replace(/\.(swarm|opencode)\.patch$/, "");
  const arm = /\.(swarm|opencode)\.patch$/.exec(name)?.[1] ?? "unknown";
  const bytes = readFileSync(join(evidence, "patches", name));
  writeFileSync(join(out, `${letter}.${task}.patch`), bytes);
  key.push({
    letter,
    task,
    arm,
    file: name,
    bytes: bytes.length,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });
});
writeFileSync(join(out, "key.json"), `${JSON.stringify({ seed, key }, null, 2)}\n`);
console.log(
  `${key.length} patch(es) blinded under ${out}; the key is key.json (read it after scoring)`,
);
