// Commit-prefix exposure scan (block 1's exposure-scan.mjs, adapted): every tracked file of this
// project at the registration commit, read from git, .br and .gz archives expanded, searched for
// the first 8 hex digits of each considered candidate's change and base commits.
//   node commit-exposure.mjs <repo-checkout> <commit> <candidates.json> <out.json>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
const [checkout, commit, candidatesPath, out] = process.argv.slice(2);
const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { maxBuffer: 1 << 30 });
const paths = git("ls-tree", "-r", "-z", "--name-only", commit).toString().split("\0").filter(Boolean);
const rows = JSON.parse(readFileSync(candidatesPath, "utf8")).map((c) => ({ ...c, matches: [] }));
let expanded = 0;
for (const path of paths) {
  let bytes = git("cat-file", "blob", `${commit}:${path}`);
  try {
    if (path.endsWith(".br")) { bytes = brotliDecompressSync(bytes); expanded += 1; }
    else if (path.endsWith(".gz")) { bytes = gunzipSync(bytes); expanded += 1; }
  } catch {}
  const text = bytes.toString("latin1");
  for (const row of rows) for (const sha of [row.changeCommit, row.baseCommit]) if (text.includes(sha.slice(0, 8))) row.matches.push(`${path} (${sha.slice(0, 8)})`);
}
writeFileSync(out, `${JSON.stringify({ commit, scannedTrackedFiles: paths.length, expandedArchives: expanded, rows, limitation: "commit-prefix search in tracked text and expanded archives; semantic task equivalence, external conversations and model training exposure remain unreviewed" }, null, 2)}\n`);
console.log(JSON.stringify({ files: paths.length, expanded, matched: rows.filter((r) => r.matches.length).map((r) => [r.changeCommit.slice(0, 9), r.matches]) }));
