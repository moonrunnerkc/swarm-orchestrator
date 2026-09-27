import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "packages/swarm-verify/package.json"), "utf8"));
const tag = process.env.GITHUB_REF_NAME;
if (process.env.GITHUB_REF_TYPE !== "tag" || tag !== `swarm-verify-v${manifest.version}`)
  throw new Error(`verifier publication requires tag swarm-verify-v${manifest.version}`);
for (const args of [
  ["run", "gates"],
  ["run", "build:verify"],
  ["run", "check:packaged"],
])
  execFileSync("npm", args, { cwd: root, stdio: "inherit" });
const raw = execFileSync(
  "npm",
  ["pack", "--workspace", "swarm-verify", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: root, encoding: "utf8" },
);
const files = JSON.parse(raw)[0].files.map((entry) => entry.path);
if (
  !files.includes("dist/swarm-verify.js") ||
  files.some((path) => /^dist\/(providers|workers|tui|select)\//.test(path))
)
  throw new Error("standalone package entry or closure is invalid");
console.log(`validated ${manifest.name}@${manifest.version} for ${tag}`);
