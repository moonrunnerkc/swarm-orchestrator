/**
 * One patch read by the study runner's own scorers, with no model: the visible check and project
 * tests, the hidden evaluator, and lint on the base and the tree. Used for rebuilt initial
 * candidates, so a repair's gain or damage is read with the same instruments as the delivered tree.
 * A rebuilt candidate is the brief's zero-context diff, which plain `git apply` refuses; it is
 * applied once to a fresh base checkout with `--unidiff-zero` and read back as a full-context diff,
 * and that diff is what the scorers receive. Both digests are recorded.
 *
 *   node score-candidate.mjs --manifest <manifest.json> --task <id> --patch <file> --out <json>
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../scripts/campaign/exec.mjs";
import { hiddenVerdict, staticVerdict, visibleVerdict } from "../../../scripts/comparison/checks.mjs";
import { cloneAtBase, commitVisibleCheck, workRoot } from "../../../scripts/comparison/workspace.mjs";

const { values } = parseArgs({ options: Object.fromEntries(["manifest", "task", "patch", "out"].map((name) => [name, { type: "string" }])) });
if (existsSync(values.out)) throw new Error(`${values.out} exists; scores are never overwritten`);
const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
const task = manifest.tasks.find((one) => one.id === values.task);
const given = readFileSync(values.patch, "utf8");
const log = commandLog(join(values.out, "..", "candidate-blobs"));
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const patch = given.trim() === "" ? given : await fullContext(given);
const visible = await visibleVerdict(log, task, task.baseCommit, patch);
const hidden = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, patch);
const statics = await staticVerdict(log, task, task.baseCommit, patch);
const result = {
  task: task.id,
  givenDigest: digest(given),
  scoredDigest: digest(patch),
  patchBytes: Buffer.byteLength(patch),
  visible: { passed: visible.passed, checkExit: visible.checkExit, projectTestExit: visible.projectTestExit },
  hidden: { verdict: hidden.verdict, basis: hidden.basis },
  static: { applicable: statics.applicable, passed: statics.passed, introducedFailure: statics.introducedFailure },
};
writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(result));

async function fullContext(text) {
  mkdirSync(workRoot, { recursive: true });
  const scratch = mkdtempSync(join(workRoot, `context-${task.id}-`));
  const checkout = join(scratch, "checkout");
  const git = async (...args) => {
    const ran = await log.run(["git", ...args], { cwd: checkout, timeoutMs: 600_000 });
    if (ran.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${ran.stderr.toString()}`);
    return ran.stdout.toString();
  };
  try {
    await cloneAtBase(log, task, task.baseCommit, checkout);
    await commitVisibleCheck(log, task, checkout);
    writeFileSync(join(scratch, "given.patch"), text.endsWith("\n") ? text : `${text}\n`);
    await git("apply", "--unidiff-zero", "--whitespace=nowarn", join(scratch, "given.patch"));
    await git("add", "--all");
    return await git("diff", "--cached", "--binary", "HEAD");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
