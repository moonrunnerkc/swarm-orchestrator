// The independent judge of one live expiry run. Nothing here was produced by the run: the
// request driver (drive.mjs), a reference repair (reference/app.ts) and the packed verifier.
//   node judge.mjs <install> <run dir>
// 1. The delivered tree (base + the run's patch) is driven with real requests in a container.
// 2. The binding the run drafted is tried, by the verifier's own driver, on the faulty base and
//    on the reference repair: a sound binding fails the first on expiry alone and passes the second.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const W = "/Users/brad/projects/recovery-2026-10-31/run-expiry";
const image = "node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413";
const [install, dir] = [resolve(process.argv[2]), resolve(process.argv[3])];
const sv = await import(pathToFileURL(join(install, "node_modules/swarm-verify/dist/index.js")).href);
const repo = join(dir, "repo");
const out = join(dir, "judge");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
const base = git(repo, "rev-parse", "HEAD").trim();
const summary = { base };

function driven(name, change) {
  const at = join(out, name);
  git(dir, "clone", "-q", repo, at);
  change(at);
  const ran = spawnSync("docker", ["run", "--rm", "--network", "none", "-v", `${at}:${at}`, "-v", `${W}/drive.mjs:/judge/drive.mjs:ro`, "-w", at, image, "node", "/judge/drive.mjs"], { encoding: "utf8", timeout: 180_000 });
  try { return JSON.parse(ran.stdout.trim().split("\n").at(-1)); } catch { return { error: `${ran.stdout}${ran.stderr}`.slice(-600) }; }
}
const failed = (found) => found.error ?? Object.entries(found.checks).filter(([, held]) => !held).map(([name]) => name);

// The judge judged: the faulty base must fail on expiry alone, the reference repair on nothing.
summary.judgeOnBase = failed(driven("tree-base", () => {}));
summary.judgeOnReference = failed(driven("tree-reference", (at) => cpSync(join(W, "reference/app.ts"), join(at, "src/app.ts"))));

const patch = join(dir, "patch.diff");
if (existsSync(patch)) {
  const delivered = driven("tree-delivered", (at) => git(at, "apply", patch));
  writeFileSync(join(out, "delivered.json"), `${JSON.stringify(delivered, null, 1)}\n`);
  summary.delivered = failed(delivered);
} else summary.delivered = "no patch";

const draft = join(dir, "drafted-security.json");
if (existsSync(draft)) {
  const file = sv.securityFileSchema.parse(JSON.parse(readFileSync(draft, "utf8")));
  const token = file.checks.find((one) => one.class === "single-use-token");
  summary.binding = { env: file.target.env, expiresAfterMs: token?.expiresAfterMs ?? null, issue: token && `${token.issue.method} ${token.issue.path}`, redeem: token && `${token.redeem.method} ${token.redeem.path}` };
  const reference = join(out, "reference-repo");
  git(dir, "clone", "-q", repo, reference);
  cpSync(join(W, "reference/app.ts"), join(reference, "src/app.ts"));
  git(reference, "-c", "user.name=judge", "-c", "user.email=judge@example.test", "commit", "-qam", "reference repair");
  const tried = async (workspace, commit) => {
    const found = await sv.tryBinding(file, { workspace, baseCommit: commit, policy: { mode: "isolated", network: "closed", dependencies: "prepare" }, swarmHome: join(out, "home") });
    return found.problem ?? found.observed.join(" | ");
  };
  summary.bindingOnBase = await tried(repo, base);
  summary.bindingOnReference = await tried(reference, git(reference, "rev-parse", "HEAD").trim());
  const statuses = (text) => Object.fromEntries([...text.matchAll(/(?:: |; )([^:;|]+?): (pass|fail|not exercised)/g)].map((one) => [one[1].trim(), one[2]]));
  const onBase = statuses(summary.bindingOnBase), onReference = statuses(summary.bindingOnReference);
  const expired = "an expired token is refused";
  summary.bindingSound = onBase[expired] === "fail" && Object.entries(onBase).every(([name, status]) => name === expired || status === "pass") && Object.values(onReference).length === 5 && Object.values(onReference).every((status) => status === "pass");
} else summary.binding = "no drafted binding";

const judgeHolds = Array.isArray(summary.judgeOnBase) && summary.judgeOnBase.join() === "an expired invite is refused with 410 and adds nobody,an expired invite stays refused" && Array.isArray(summary.judgeOnReference) && summary.judgeOnReference.length === 0;
summary.judgeHolds = judgeHolds;
writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);
console.log(JSON.stringify(summary, null, 1));
console.log(`verdict ${!judgeHolds ? "judge-unsound" : Array.isArray(summary.delivered) && summary.delivered.length === 0 ? "correct" : "incorrect"}; binding ${summary.bindingSound === true ? "sound" : summary.bindingSound === false ? "unsound" : "none"}`);
