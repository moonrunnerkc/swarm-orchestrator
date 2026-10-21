// The published accessor patch's exposed spies against the surface the task named: the accessor
// spies sinon.spy(obj, "prop", ["get"]) produces, and the upstream fix. No model. Three trees
// are read, each a clone at the pinned base: the base with the whole patch applied, the base
// with only the patch's test file applied (the authored tests as a control), and the upstream
// commit. Portable: the mirror is cloned from GitHub where the machine has none, and each tree
// is installed from the base's own lockfile.
//
//   node api-audit.mjs --patch <file> --out <json> [--mirror <bare clone of sinonjs/sinon>]
//
// The patch is held to the digest the 2026-10-21 comparison recorded for the Swarm accessor
// launch (`sha256:aa75e95d...`); another file is audited as given and the digest reported.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    patch: { type: "string" },
    out: { type: "string" },
    mirror: { type: "string" },
  },
});
if (values.patch === undefined || values.out === undefined)
  throw new Error("usage: api-audit.mjs --patch <file> --out <json> [--mirror <bare clone>]");

const repository = "sinonjs/sinon";
const base = "8c663edeccc5e2fa5ddaaf4cab979726cf78304a";
const upstream = "002ee82bc5329fd88e7083aeedb7520c0260d1ab";
const recordedDigest = "sha256:aa75e95d8470ef44d32d80c46f8c3cf7e8a6e071cbea5562ef21e7f83832f396";
const patch = resolve(values.patch);
const patchDigest = `sha256:${createHash("sha256").update(readFileSync(patch)).digest("hex")}`;

const mirror =
  values.mirror ?? join(homedir(), ".cache/swarm-comparison/mirrors", `${repository.replace("/", "__")}.git`);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
if (!existsSync(mirror)) {
  mkdirSync(dirname(mirror), { recursive: true });
  execFileSync("git", ["clone", "--quiet", "--mirror", `https://github.com/${repository}.git`, mirror]);
}
for (const commit of [base, upstream])
  if (spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: mirror }).status !== 0)
    execFileSync("git", ["fetch", "--quiet", `https://github.com/${repository}.git`, commit], { cwd: mirror });

const root = mkdtempSync(join(tmpdir(), "sinon-api-audit-"));
const npmEnvironment = {
  ...process.env,
  npm_config_fund: "false",
  npm_config_audit: "false",
  npm_config_update_notifier: "false",
  PUPPETEER_SKIP_DOWNLOAD: "true",
};
const tree = (name, commit) => {
  const directory = join(root, name);
  execFileSync("git", ["clone", "--quiet", "--no-checkout", `file://${mirror}`, directory]);
  git(directory, "checkout", "--quiet", "--detach", commit);
  execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: directory, env: npmEnvironment, stdio: "ignore" });
  return directory;
};

// What a spy made by sinon's own accessor spying supports, and whether the stub's exposed
// accessors support the same: the task's "mirroring the spy.get and spy.set surface".
const probe = `
import createStub from "./src/sinon/stub.js";
import spy from "./src/sinon/spy.js";
const result = {};
const obj = { prop: "foo" };
const stub = createStub(obj, "prop").set((value) => { obj.example = value; });
obj.prop = "bar";
result.setterCallCount = stub.setter.callCount;
result.setterCalledWithBar = stub.setter.calledWith("bar");
try { stub.setter.withArgs("bar"); result.setterWithArgs = "ok"; } catch (error) { result.setterWithArgs = String(error); }
const getterStub = createStub({ prop: "foo" }, "prop").get(() => "bar");
try { getterStub.getter.withArgs(); result.getterWithArgs = "ok"; } catch (error) { result.getterWithArgs = String(error); }
const spied = {};
Object.defineProperty(spied, "prop", { get() { return "foo"; }, set(value) { spied.example = value; }, configurable: true });
const accessorSpies = spy(spied, "prop", ["set"]);
spied.prop = "bar";
try { accessorSpies.set.withArgs("bar"); result.spySetWithArgs = "ok"; } catch (error) { result.spySetWithArgs = String(error); }
const names = (value) => { const seen = new Set(); for (let at = value; at !== null && at !== Function.prototype && at !== Object.prototype; at = Object.getPrototypeOf(at)) for (const name of Object.getOwnPropertyNames(at)) seen.add(name); return seen; };
const reference = names(accessorSpies.set);
const exposed = names(stub.setter);
result.missingFromStubSetter = [...reference].filter((name) => !exposed.has(name) && typeof accessorSpies.set[name] === "function").sort();
result.missingNonFunctions = [...reference].filter((name) => !exposed.has(name) && typeof accessorSpies.set[name] !== "function").sort();
result.isSpyShape = { id: typeof stub.setter.id, displayName: stub.setter.displayName ?? null, fakes: Array.isArray(stub.setter.fakes) };
process.stdout.write(JSON.stringify(result));
`;
const runProbe = (directory) => {
  writeFileSync(join(directory, "api-probe.mjs"), probe);
  const ran = spawnSync(process.execPath, ["api-probe.mjs"], { cwd: directory, encoding: "utf8" });
  return ran.status === 0 ? JSON.parse(ran.stdout) : { failed: ran.status, stderr: ran.stderr.slice(-2000) };
};
const mocha = (directory, label) => {
  const ran = spawnSync("npx", ["mocha", "-R", "json", "test/src/stub-test.js"], {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: npmEnvironment,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(ran.stdout.slice(ran.stdout.indexOf("{")));
  } catch {}
  return {
    label,
    exitCode: ran.status,
    tests: parsed?.stats?.tests ?? null,
    passes: parsed?.stats?.passes ?? null,
    failures: parsed?.stats?.failures ?? null,
    failed: (parsed?.failures ?? []).map((one) => one.fullTitle),
  };
};

const report = {
  repository,
  base,
  upstream,
  patch: { path: patch, digest: patchDigest, recorded: patchDigest === recordedDigest ? recordedDigest : `not the recorded ${recordedDigest}` },
  trees: {},
};
const patched = tree("patched", base);
git(patched, "apply", "--whitespace=nowarn", patch);
report.trees.patched = {
  status: git(patched, "status", "--short"),
  probe: runProbe(patched),
  authoredTests: mocha(patched, "the patch's test file on the patch's source"),
};
const testsOnly = tree("tests-only", base);
git(testsOnly, "apply", "--whitespace=nowarn", "--include=test/src/stub-test.js", patch);
report.trees.testsOnlyOnBase = {
  status: git(testsOnly, "status", "--short"),
  authoredTests: mocha(testsOnly, "the patch's test file on the base's source"),
};
const fixed = tree("upstream", upstream);
report.trees.upstream = { probe: runProbe(fixed) };
report.auditedAt = new Date().toISOString();
report.node = process.version;
writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 1));
