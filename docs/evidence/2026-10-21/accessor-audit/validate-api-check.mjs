// The sensitivity of api-check.mjs, read three ways before it judges any launch: it must fail on
// the base (nothing exposed), fail on the published accessor patch (exposed, without the spy
// surface) and pass on the upstream reference. No model.
//   node validate-api-check.mjs --patch <published accessor patch> --out <json> [--mirror <bare clone>]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { patch: { type: "string" }, out: { type: "string" }, mirror: { type: "string" } },
});
if (values.patch === undefined || values.out === undefined)
  throw new Error("usage: validate-api-check.mjs --patch <file> --out <json> [--mirror <bare clone>]");
const repository = "sinonjs/sinon";
const base = "8c663edeccc5e2fa5ddaaf4cab979726cf78304a";
const upstream = "002ee82bc5329fd88e7083aeedb7520c0260d1ab";
const check = readFileSync(new URL("./api-check.mjs", import.meta.url), "utf8");
const mirror =
  values.mirror ?? join(homedir(), ".cache/swarm-comparison/mirrors", `${repository.replace("/", "__")}.git`);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
if (!existsSync(mirror)) {
  mkdirSync(dirname(mirror), { recursive: true });
  execFileSync("git", ["clone", "--quiet", "--mirror", `https://github.com/${repository}.git`, mirror]);
}
const root = mkdtempSync(join(tmpdir(), "sinon-api-check-"));
const npmEnvironment = {
  ...process.env,
  npm_config_fund: "false",
  npm_config_audit: "false",
  npm_config_update_notifier: "false",
  PUPPETEER_SKIP_DOWNLOAD: "true",
};
const tree = (name, commit, patch) => {
  const directory = join(root, name);
  execFileSync("git", ["clone", "--quiet", "--no-checkout", `file://${mirror}`, directory]);
  git(directory, "checkout", "--quiet", "--detach", commit);
  if (patch !== undefined) git(directory, "apply", "--whitespace=nowarn", resolve(patch));
  execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: directory, env: npmEnvironment, stdio: "ignore" });
  writeFileSync(join(directory, "acceptance-api-check.mjs"), check);
  const ran = spawnSync(process.execPath, ["acceptance-api-check.mjs"], { cwd: directory, encoding: "utf8" });
  return { exitCode: ran.status, output: `${ran.stdout}${ran.stderr}`.trim().split("\n").slice(-4).join("\n") };
};
const report = {
  check: "api-check.mjs",
  expectation: "fails on the base, fails on the published patch, passes on the upstream reference",
  base: tree("base", base),
  publishedPatch: tree("patched", base, values.patch),
  upstream: tree("upstream", upstream),
  validatedAt: new Date().toISOString(),
};
report.sensitive =
  report.base.exitCode !== 0 && report.publishedPatch.exitCode !== 0 && report.upstream.exitCode === 0;
writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 1));
