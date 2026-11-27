// The independent judge of one live run. Nothing here was produced by the run: the packed
// verifier, the hand-written binding and acceptance test beside the example, the approved rules,
// and two reference implementations (one correct, one with the labeled ownership fault).
//   node judge.mjs <install> <run dir> <invoice|notes> <feature|repair>
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const W = "/Users/brad/projects/recovery-2026-10-31/run-closeout";
const EX = "/Users/brad/projects/recovery-2026-10-31/wt/assure/examples";
const image = "node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413";
const [install, dir, example, variant] = [resolve(process.argv[2]), resolve(process.argv[3]), process.argv[4], process.argv[5]];
const sv = await import(pathToFileURL(join(install, "node_modules/swarm-verify/dist/index.js")).href);
const repo = join(dir, "repo");
const out = join(dir, "judge");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
const base = git(repo, "rev-parse", "HEAD").trim();
const summary = { example, variant, base };

/** A clone of the base with files laid over it or a patch applied. */
function tree(name, { overlay = null, patch = null } = {}) {
  const at = join(out, name);
  git(dir, "clone", "-q", repo, at);
  if (overlay !== null) cpSync(overlay, at, { recursive: true });
  if (patch !== null) git(at, "apply", patch);
  return at;
}
/** One test file run in a container with no network; true where it exits 0. */
function runs(at, file) {
  const ran = spawnSync("docker", ["run", "--rm", "--network", "none", "-v", `${at}:${at}`, "-w", at, image, "node", "--test", file], { encoding: "utf8" });
  return { pass: ran.status === 0, tail: `${ran.stdout}${ran.stderr}`.split("\n").filter((line) => /^ℹ (tests|pass|fail)|✖|not ok/.test(line)).slice(0, 12).join(" | ") };
}
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** A patch judged by the packed verifier against a binding and the approved rules. */
async function verified(name, patch, binding) {
  const result = await sv.verify(
    {
      version: sv.requestVersion,
      repository: repo,
      base: { commit: base },
      candidate: { kind: "patch", path: patch, sha256: sha(patch) },
      requirements: [
        sv.securityRequirement("R1", "ownership", binding.checks[0]),
        { id: "R2", text: "The change follows the approved conventions", source: "profile", kind: "other", evidence: { conventions: rules } },
      ],
      behavior: sv.securityChecks(binding, "user-acceptance", new Map([["ownership", "R1"]])),
      policy: { execution: { mode: "isolated", network: "closed", dependencies: "prepare" } },
      artifacts: { directory: join(out, `evidence-${name}`) },
      producer: { instructions: [] },
    },
    { verifierVersion: sv.verifierVersion },
  );
  return {
    state: result.state,
    ownership: result.requirements[0].status,
    conventions: result.requirements[1].status,
    cases: result.behavior[0]?.cases.map((one) => `${one.name}: base ${one.base}, candidate ${one.candidate}${one.detail ? ` (${one.detail})` : ""}`),
    conventionFailures: result.requirements[1].evidence.filter((one) => one.outcome === "fail").map((one) => `${one.ref}: ${one.detail}`),
    regression: result.regression.status,
  };
}
const rules = sv.conventionSetSchema.parse(JSON.parse(readFileSync(join(W, "seeded/rules.json"), "utf8")));
const handBinding = sv.securityFileSchema.parse(JSON.parse(readFileSync(join(EX, `${example}-api/security.json`), "utf8")));
const reference = (kind) => join(W, "reference", example, kind);
const accept = example === "invoice" ? [join(EX, "invoice-api-checks", variant), "test/download.accept.test.ts"] : [join(EX, "notes-api-checks"), "spec/delete.accept.test.ts"];

// 1. The delivered patch: the verifier with the hand-written binding, and the hand-written test.
const patch = join(dir, "patch.diff");
if (existsSync(patch) && statSync(patch).size > 0) {
  summary.patchSha256 = sha(patch);
  summary.delivered = await verified("delivered", patch, handBinding);
  const delivered = tree("delivered", { patch });
  cpSync(accept[0], delivered, { recursive: true });
  summary.independentTest = runs(delivered, accept[1]);
} else summary.delivered = null;

// 2. The generated acceptance test, on the base and on the two references.
const found = (at) => readdirSync(at, { withFileTypes: true, recursive: true }).filter((one) => one.isFile() && one.name.includes("swarm-r1")).map((one) => join(one.parentPath, one.name));
const generated = found(join(dir, "home")).find((path) => !path.includes("/sessions/")) ?? found(join(dir, "home"))[0];
const laidAt = /run from (\S+)/.exec(readFileSync(join(dir, "run.out"), "utf8"))?.[1] ?? null;
if (generated !== undefined && laidAt !== null) {
  writeFileSync(join(dir, "generated-test.txt"), readFileSync(generated));
  const on = (name, options) => {
    const at = tree(name, options);
    mkdirSync(dirname(join(at, laidAt)), { recursive: true });
    cpSync(generated, join(at, laidAt));
    return runs(at, laidAt);
  };
  summary.generatedTest = {
    path: laidAt,
    sha256: sha(generated),
    atBase: on("gen-base"),
    onCorrectReference: on("gen-secure", { overlay: reference("secure") }),
    onFaultyReference: on("gen-insecure", { overlay: reference("insecure") }),
  };
} else summary.generatedTest = null;

// 3. The drafted binding: does it accept the correct reference and reject the faulty one?
const drafted = join(dir, "drafted-security.json");
if (existsSync(drafted)) {
  const binding = sv.securityFileSchema.parse(JSON.parse(readFileSync(drafted, "utf8")));
  const patchOf = (kind) => {
    const at = tree(`ref-${kind}`, { overlay: reference(kind) });
    git(at, "add", "-A");
    const file = join(out, `reference-${kind}.patch`);
    writeFileSync(file, execFileSync("git", ["diff", "--cached", "--binary"], { cwd: at }));
    return statSync(file).size > 0 ? file : null;
  };
  const [secure, insecure] = [patchOf("secure"), patchOf("insecure")];
  summary.draftedBinding = {
    sha256: sha(drafted),
    binding,
    onCorrectReference: secure === null ? "the base is the correct reference" : await verified("draft-secure", secure, binding),
    onFaultyReference: insecure === null ? "the base is the faulty reference; see the base column above" : await verified("draft-insecure", insecure, binding),
  };
} else summary.draftedBinding = null;

const d = summary.delivered;
const g = summary.generatedTest;
const b = summary.draftedBinding;
const verdict = [
  `delivered=${d === null ? "none" : `${d.state}/ownership:${d.ownership}/conventions:${d.conventions}`}`,
  `independent-test=${summary.independentTest === undefined ? "n/a" : summary.independentTest.pass ? "pass" : "fail"}`,
  `generated-test=${g === null ? "none" : `base:${g.atBase.pass ? "pass" : "fail"},correct:${g.onCorrectReference.pass ? "pass" : "fail"},faulty:${g.onFaultyReference.pass ? "pass" : "fail"}`}`,
  `drafted-binding=${b === null ? "none" : `correct:${b.onCorrectReference.ownership ?? "base"},faulty:${b.onFaultyReference.ownership ?? "base"}`}`,
].join(" ");
writeFileSync(join(dir, "judge.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`verdict ${verdict}`);
console.log(JSON.stringify(summary, null, 2));
