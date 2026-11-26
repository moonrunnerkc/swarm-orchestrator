// The evaluation instrument, apart from anything a run generated: the delivered patch judged by
// the packed verifier against the hand-written ownership binding and the approved conventions.
//   node eval.mjs <install> <repo at its base commit> <patch> <binding.json> <rules.json> <out dir>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [install, repo, patch, bindingPath, rulesPath, out] = process.argv.slice(2).map((one) => resolve(one));
const sv = await import(pathToFileURL(join(install, "node_modules/swarm-verify/dist/index.js")).href);
const binding = sv.securityFileSchema.parse(JSON.parse(readFileSync(bindingPath, "utf8")));
const rules = sv.conventionSetSchema.parse(JSON.parse(readFileSync(rulesPath, "utf8")));
const bytes = readFileSync(patch);
mkdirSync(out, { recursive: true });
const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const result = await sv.verify(
  {
    version: sv.requestVersion,
    repository: repo,
    base: { commit: base },
    candidate: { kind: "patch", path: patch, sha256: createHash("sha256").update(bytes).digest("hex") },
    requirements: [
      sv.securityRequirement("R1", "ownership", binding.checks[0]),
      { id: "R2", text: "The change follows the approved conventions", source: "profile", kind: "other", evidence: { conventions: rules } },
    ],
    behavior: sv.securityChecks(binding, "user-acceptance", new Map([["ownership", "R1"]])),
    policy: { execution: { mode: "isolated", network: "closed", dependencies: "prepare" } },
    artifacts: { directory: join(out, "evidence") },
    producer: { instructions: [] },
  },
  { verifierVersion: sv.verifierVersion },
);
const summary = {
  state: result.state,
  ownership: result.requirements[0].status,
  conventions: result.requirements[1].status,
  cases: result.behavior[0]?.cases.map((one) => `${one.name}: base ${one.base}, candidate ${one.candidate}${one.detail ? ` (${one.detail})` : ""}`),
  conventionFailures: result.requirements[1].evidence.filter((one) => one.outcome === "fail").map((one) => `${one.ref}: ${one.detail}`),
  regression: result.regression.status,
  reasons: result.reasons,
  bundle: result.evidence.bundle,
};
writeFileSync(join(out, "evaluation.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
