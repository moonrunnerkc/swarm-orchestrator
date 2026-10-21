// A git-applicable patch for one file from its base and changed contents.
//   node mkpatch.mjs <path-in-tree> <base-file> <changed-file> <out>
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const [path, baseFile, changedFile, out] = process.argv.slice(2);
const ran = spawnSync("diff", ["-u", "--label", `a/${path}`, "--label", `b/${path}`, baseFile, changedFile], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const patch = `diff --git a/${path} b/${path}\n${ran.stdout}`;
writeFileSync(out, patch);
console.log(patch);
