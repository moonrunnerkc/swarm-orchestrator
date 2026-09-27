import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scrubText } from "../src/evidence/scrub.ts";
import { retainActionArtifacts } from "./action-artifacts.mjs";

if (process.env.GITHUB_EVENT_NAME === "pull_request_target")
  throw new Error(
    "privileged pull_request_target verification is refused; use pull_request on a disposable runner",
  );
if (process.env.RUNNER_ENVIRONMENT !== "github-hosted")
  throw new Error(
    "this Action requires a disposable GitHub-hosted runner; use the CLI for explicitly managed environments",
  );
const artifact = `swarm-verification-${randomUUID()}`;
const directory = join(process.env.RUNNER_TEMP, `swarm-action-${randomUUID()}`);
mkdirSync(directory, { mode: 0o700 });
const report = join(directory, "report.json");
const summary = join(directory, "summary.md");
const home = join(directory, "home");
mkdirSync(home, { mode: 0o700 });
const args = [
  join(process.env.SWARM_ACTION_ROOT, "packages/swarm-verify/dist/swarm-verify.js"),
  "ci",
  "--workspace",
  resolve(process.env.SWARM_INPUT_WORKSPACE),
  "--branch",
  process.env.SWARM_INPUT_BRANCH,
  "--base",
  process.env.SWARM_INPUT_BASE,
  "--isolation",
  `docker:${process.env.SWARM_INPUT_IMAGE}`,
  "--require-isolation",
  "--json",
  "--summary",
  summary,
  "--bundle",
  join(directory, "bundle"),
];
if (process.env.SWARM_INPUT_GOAL)
  args.push("--goal-contract", resolve(process.env.SWARM_INPUT_GOAL));
if (process.env.SWARM_INPUT_ORACLE) args.push("--oracle", process.env.SWARM_INPUT_ORACLE);
const ran = spawnSync(process.execPath, args, {
  encoding: "utf8",
  timeout: 1_800_000,
  maxBuffer: 4_000_000,
  env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
});
const status = ran.status ?? 1;
writeFileSync(report, scrubText(ran.stdout ?? "").value, { mode: 0o600 });
// Raw candidate output is never echoed to the workflow command channel.
writeFileSync(
  join(directory, "diagnostic.txt"),
  scrubText(ran.stderr ?? "").value.slice(0, 1_000_000),
  {
    mode: 0o600,
  },
);
try {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, readFileSync(summary));
} catch {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    "Swarm verification could not produce an assessment. Consult the retained diagnostic artifact.\n",
  );
}
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  `\nEvidence download: the artifact named ${artifact} on this workflow run. It contains the summary, JSON report and signed bundle.\n`,
);
const retention = retainActionArtifacts(directory);
if (!retention.complete)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    "Evidence retention is incomplete; original verifier status is preserved separately.\n",
  );
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `status=${status}\nreport=${report}\nsummary=${summary}\nevidence=${directory}\nretained=${retention.destination}\nretention=${retention.complete ? "complete" : "incomplete"}\nartifact=${artifact}\n`,
);
// The composite action retains artifacts before its final step returns this exact status.
