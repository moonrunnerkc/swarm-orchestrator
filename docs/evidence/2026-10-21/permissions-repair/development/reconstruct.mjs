// Reconstruct a file as the model left it before a given ledger sequence, by replaying the
// write and edit tool calls recorded on it over its base content.
//   node reconstruct.mjs <session> <path> <before-sequence> <base-file> <out-file>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [session, path, beforeText, baseFile, outFile] = process.argv.slice(2);
const before = Number(beforeText);
const ledger = readFileSync(join(session, "ledger.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
let content = readFileSync(baseFile, "utf8");
for (const record of ledger) {
  if (record.sequence >= before || record.type !== "tool-call") continue;
  const blob = join(session, "blobs", `${record.payloadDigest.slice(7)}.json`);
  if (!existsSync(blob)) continue;
  const payload = JSON.parse(readFileSync(blob, "utf8"));
  if (payload.decision !== "allowed" || payload.input?.path !== path) continue;
  if (payload.toolName === "write") {
    content = payload.input.content;
    console.log(`${record.sequence}: write (${content.length} chars)`);
  } else if (payload.toolName === "edit") {
    const { find, replace } = payload.input;
    const count = content.split(find).length - 1;
    if (count !== 1) {
      console.log(`${record.sequence}: edit matched ${count} times; tool output: ${JSON.stringify(payload.output).slice(0, 200)}`);
      if (count === 0) continue;
    }
    content = content.replace(find, () => replace);
    console.log(`${record.sequence}: edit applied`);
  }
}
writeFileSync(outFile, content);
