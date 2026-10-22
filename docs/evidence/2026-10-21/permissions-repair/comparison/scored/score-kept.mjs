// Score a kept launch workspace exactly as the runner would have: the final patch against the
// base-plus-visible-check commit, the visible verdict and the hidden verdict.
//   node score-kept.mjs <manifest> <task-id> <workspace> <out-json>
//
// This reads a launch's kept workspace on the host that ran it, so it is not the portable
// path; `scripts/comparison/rescore.mjs` scores the published patch from the pinned commits on
// any machine. As first committed on 2026-10-21 the three imports below named the harness by an
// absolute path on that host; they were made repository-relative the same day, with the logic
// unchanged, so the score it wrote (`sinon-bugfix-stub-accessor-calls.swarm.json`) is
// reproducible from a clone.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { commandLog, storeBlob } from "../../../../../../scripts/campaign/exec.mjs";
import { hiddenVerdict, visibleVerdict } from "../../../../../../scripts/comparison/checks.mjs";
import { comparisonRoot, finalPatch } from "../../../../../../scripts/comparison/workspace.mjs";

const [manifestPath, taskId, workspace, out] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const task = manifest.tasks.find((one) => one.id === taskId);
const log = commandLog(join(comparisonRoot, "blobs"));
// The launch's base is the visible-check commit on top of the task's base: the first commit in the workspace's log is it.
const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).stdout.trim();
const patch = await finalPatch(log, workspace, base);
const patchDigest = storeBlob(join(comparisonRoot, "blobs"), Buffer.from(patch));
const visible = await visibleVerdict(log, task, task.baseCommit, patch);
const hidden = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, patch);
const result = {
  task: taskId,
  workspace,
  base,
  patchDigest,
  patchBytes: Buffer.byteLength(patch),
  visible: { passed: visible.passed, checkExit: visible.checkExit, projectTestExit: visible.projectTestExit, detail: visible.detail.slice(-3000) },
  hidden: { verdict: hidden.verdict, basis: hidden.basis, policy: hidden.policy ?? null, displaced: hidden.displaced ?? null, detail: (hidden.detail ?? "").slice(-3000) },
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(out.replace(/\.json$/, ".patch"), patch);
console.log(JSON.stringify({ ...result, visible: { ...result.visible, detail: undefined }, hidden: { ...result.hidden, detail: undefined } }, null, 1));
