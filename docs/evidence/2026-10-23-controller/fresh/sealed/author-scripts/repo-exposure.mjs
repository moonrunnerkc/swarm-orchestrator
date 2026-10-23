// Repository-level exposure check for block 2: does `owner/name` (or the mirror spelling
// owner__name) appear anywhere under docs/evidence/ or scripts/comparison/ at the registration
// commit? Reads tracked blobs at that commit with git (not the worktree), expanding .br and .gz
// archives. Read-only over the repository.
//   node repo-exposure.mjs <repo-checkout> <commit> <out.json> owner/name...
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
const [checkout, commit, out, ...repositories] = process.argv.slice(2);
const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { maxBuffer: 1 << 30 });
const paths = git("ls-tree", "-r", "-z", "--name-only", commit, "--", "docs/evidence", "scripts/comparison").toString().split("\0").filter(Boolean);
const needles = repositories.map((r) => ({ repository: r, forms: [r.toLowerCase(), r.replace("/", "__").toLowerCase()], matches: [] }));
let expanded = 0;
const batch = 400;
for (let i = 0; i < paths.length; i += 1) {
  const path = paths[i];
  let bytes = git("cat-file", "blob", `${commit}:${path}`);
  try {
    if (path.endsWith(".br")) { bytes = brotliDecompressSync(bytes); expanded += 1; }
    else if (path.endsWith(".gz")) { bytes = gunzipSync(bytes); expanded += 1; }
  } catch { /* not an archive after all; scan raw */ }
  const text = bytes.toString("utf8").toLowerCase();
  for (const needle of needles) if (needle.forms.some((form) => text.includes(form))) needle.matches.push(path);
}
writeFileSync(out, `${JSON.stringify({ commit, roots: ["docs/evidence", "scripts/comparison"], scannedFiles: paths.length, expandedArchives: expanded, repositories: needles.map(({ repository, forms, matches }) => ({ repository, forms, matchCount: matches.length, matches })) }, null, 2)}\n`);
for (const needle of needles) console.log(`${needle.repository}\t${needle.matches.length}`);
console.log(`scanned ${paths.length} files, expanded ${expanded} archives`);
