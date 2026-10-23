import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
const inventory = JSON.parse(readFileSync(process.argv[2]));
const files = execFileSync("git", ["ls-files", "-z"], {maxBuffer: 16 * 1024 * 1024}).toString().split("\0")
  .filter(path => path && !path.startsWith("docs/evidence/2026-10-22-capability/") && !path.startsWith("docs/capability-study-2026-10-22"));
const rows = inventory.candidates.map(task => ({id: task.id, changeCommit: task.changeCommit, matches: []}));
let packed = 0;
for (const path of files) {
  let bytes = readFileSync(path);
  if (path.endsWith("archive.json.br")) {bytes = brotliDecompressSync(bytes); packed++;}
  const text = bytes.toString("utf8");
  for (const row of rows) {
    if (text.includes(row.changeCommit.slice(0, 8))) row.matches.push(path);
  }
}
writeFileSync(process.argv[3], JSON.stringify({scannedTrackedFiles: files.length, expandedArchives: packed, rows,
  limitation: "commit-prefix search in tracked text and expanded archives; semantic task equivalence, external/private conversations and model training exposure remain unreviewed"
}, null, 2));
console.log(JSON.stringify({files: files.length, packed, matches: rows.filter(row => row.matches.length).length}));
