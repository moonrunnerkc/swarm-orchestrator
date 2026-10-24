// Replays the recorded edit tool calls to src/utils.ts, in ledger order, over the base file, and
// writes each intermediate version. The ledger's copies are scrubbed: the three spans the scrubber
// replaced are restored from the delivered (unscrubbed) patch, and the script fails if any other
// redaction remains or if a find string does not match exactly once.
// Usage: node replay-utils-edits.mjs <session-dir> <base-utils.ts> <out-dir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const [dir, baseFile, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const restore = (text) => text
  .replace("const keys = [redacted:credential-assignment]);", "const keys = Object.keys(parsed);")
  .replace("let hasMatchingKey = [redacted:credential-assignment];", "let hasMatchingKey = false;")
  .replace("hasMatchingKey = [redacted:credential-assignment];", "hasMatchingKey = true;");
const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
let text = readFileSync(baseFile, "utf8");
for (const r of lines) {
  if (r.type !== "tool-call") continue;
  const p = JSON.parse(readFileSync(join(dir, "blobs", `${r.payloadDigest.replace("sha256:", "")}.json`), "utf8"));
  if (p.decision !== "allowed" || p.toolName !== "edit" || p.input.path !== "src/utils.ts") continue;
  const find = restore(p.input.find);
  const replace = restore(p.input.replace);
  if (find.includes("[redacted") || replace.includes("[redacted")) throw new Error(`unrestored redaction at #${r.sequence}`);
  const count = text.split(find).length - 1;
  if (count !== 1) throw new Error(`find matched ${count} times at #${r.sequence}`);
  text = text.replace(find, replace);
  writeFileSync(join(outDir, `utils.after-${r.sequence}.ts`), text);
  console.log(`#${r.sequence} applied (${new Date(r.timestamp).toISOString()})`);
}
