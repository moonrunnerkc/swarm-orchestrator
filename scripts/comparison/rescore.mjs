/**
 * Score a recorded patch again from pinned commits, with no model and nothing of the launch's
 * host: the task from the stage's frozen manifest, the patch bytes from the stage's published
 * records or packs held to the digest the record carries, the base and upstream commits from a
 * mirror this script clones when the machine has none. Two readings, kept apart as the runner
 * keeps them:
 *
 * - the delivered tree's own reading (the runner's visible verdict): the visible check and the
 *   project's test command over the exact patch, its own test files included;
 * - the hidden overlay's reading (the runner's hidden verdict): the allowed-change policy, then
 *   the sealed upstream test files written over the patched tree, which displaces any file the
 *   patch wrote at those paths; the displaced files are named, since the project-test result of
 *   this reading is the overlaid tree's and not the delivered tree's.
 *
 * This is supplemental scoring and says so in its output: it never rewrites a launch record,
 * and a stage's frozen scores stand as the runner wrote them.
 *
 *   node scripts/comparison/rescore.mjs --stage <directory with manifest.json> --task <id> --arm swarm|opencode [--patch <file>] [--out <json>]
 *
 * Without --patch the patch is read from the stage's `records/<task>.<arm>.patch` or
 * `scored/<task>.<arm>.patch`, in the tree or in a pack under the stage or its parent, and
 * refused unless its digest is one a record of that task and arm carries. With --patch the
 * bytes are scored as given and the digest is reported, whether or not any record carries it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { commandLog } from "../campaign/exec.mjs";
import { packedFiles, readStageRecord, stageRecordNames } from "../pilot/stage-files.mjs";
import { hiddenVerdict, staticVerdict, visibleVerdict } from "./checks.mjs";
import { resolveFrozenInput } from "./launch-config.mjs";
import { taskSchema } from "./schema.mjs";
import { comparisonRoot, ensureMirror, resolveFull } from "./workspace.mjs";

const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** A stage file's text: from the tree, or from a pack under the stage or its parent directory. */
export function stageFile(stage, path) {
  const inTree = join(stage, path);
  if (existsSync(inTree)) return readFileSync(inTree, "utf8");
  const own = packedFiles(stage).get(path);
  if (own !== undefined) return own;
  const parent = dirname(stage);
  const under = `${stage.slice(parent.length + 1)}/${path}`;
  return packedFiles(parent).get(under) ?? null;
}

/** Every digest a stage's records and supplemental scores carry for one task and arm's patch. */
export function recordedPatchDigests(stage, task, arm) {
  const digests = new Map();
  for (const name of stageRecordNames(stage)) {
    if (!name.startsWith(`${task}.${arm}.`) || !name.endsWith(".json")) continue;
    const record = JSON.parse(readStageRecord(join(stage, "records", name)));
    if (typeof record.finalPatchDigest === "string")
      digests.set(record.finalPatchDigest, `records/${name}`);
  }
  const scored = stageFile(stage, `scored/${task}.${arm}.json`);
  if (scored !== null) {
    const supplemental = JSON.parse(scored);
    if (typeof supplemental.patchDigest === "string")
      digests.set(supplemental.patchDigest, `scored/${task}.${arm}.json (supplemental)`);
  }
  return digests;
}

/** The recorded patch for a task and arm, with the record whose digest it matches; refused otherwise. */
export function recordedPatch(stage, task, arm) {
  const digests = recordedPatchDigests(stage, task, arm);
  for (const path of [`records/${task}.${arm}.patch`, `scored/${task}.${arm}.patch`]) {
    const text = stageFile(stage, path);
    if (text === null) continue;
    const digest = digestOf(text);
    const carrier = digests.get(digest);
    if (carrier === undefined)
      throw new Error(
        `${path} hashes to ${digest}, which no record of ${task} ${arm} carries (${[...digests.keys()].join(", ") || "none recorded"})`,
      );
    return { path, text, digest, carrier };
  }
  throw new Error(
    `no patch for ${task} ${arm} under ${stage}: neither records/ nor scored/ holds one, in the tree or in a pack`,
  );
}

function parseArguments(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index];
    if (!word.startsWith("--")) throw new Error(`unexpected argument ${word}`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) args.set(word.slice(2), "true");
    else {
      args.set(word.slice(2), next);
      index += 1;
    }
  }
  return args;
}

export async function rescore({ stage, taskId, arm, patchFile, blobs }) {
  const manifest = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"));
  const task = manifest.tasks.find((one) => one.id === taskId);
  if (task === undefined) throw new Error(`${taskId} is not a task of ${stage}/manifest.json`);
  taskSchema.parse(task);
  const source =
    patchFile === undefined
      ? recordedPatch(stage, taskId, arm)
      : (() => {
          const text = readFileSync(patchFile, "utf8");
          const digest = digestOf(text);
          return {
            path: patchFile,
            text,
            digest,
            carrier:
              recordedPatchDigests(stage, taskId, arm).get(digest) ??
              "none: the bytes were given, not read from a record",
          };
        })();
  mkdirSync(blobs, { recursive: true });
  const log = commandLog(blobs);
  await ensureMirror(log, task);
  const commits = await resolveFull(log, task);
  // The launch committed the frozen lockfile under the patch, so the scored trees do too.
  const lockInput = manifest.harnessLockfiles?.[taskId];
  const lock = lockInput === undefined ? null : resolveFrozenInput(manifest, lockInput);
  if (lockInput !== undefined && lock === null)
    throw new Error(
      `the frozen lockfile ${lockInput.digest} for ${taskId} is not under the stage's input roots`,
    );
  const harnessLock = lock?.bytes ?? null;
  const started = Date.now();
  const delivered = await visibleVerdict(log, task, commits.base, source.text, { harnessLock });
  const overlay = await hiddenVerdict(log, task, commits.base, commits.upstream, source.text, {
    harnessLock,
  });
  const statics = await staticVerdict(log, task, commits.base, source.text, { harnessLock });
  return {
    schema: "swarm-ordinary-comparison.rescore.v1",
    kind: "supplemental scoring from pinned commits; the launch's frozen record is not changed",
    stage,
    manifestDigest: digestOf(readFileSync(join(stage, "manifest.json"))),
    task: taskId,
    arm,
    commits,
    harnessLockfile: lockInput?.digest ?? null,
    patch: {
      path: source.path,
      digest: source.digest,
      bytes: Buffer.byteLength(source.text),
      carrier: source.carrier,
    },
    deliveredTree: {
      reading:
        "the exact patch's own tree: the visible check and the project's test command, its own test files included",
      passed: delivered.passed,
      checkExit: delivered.checkExit,
      projectTestExit: delivered.projectTestExit,
      detail: delivered.detail.slice(-3000),
    },
    staticReading: {
      reading:
        "the project's lint over the delivered tree beside the base's, the acceptance directory removed",
      applicable: statics.applicable,
      baseExit: statics.baseExit,
      deliveredExit: statics.deliveredExit,
      passed: statics.passed,
      introducedFailure: statics.introducedFailure,
    },
    hiddenOverlay: {
      reading:
        "the allowed-change policy, then the sealed upstream test files written over the patched tree",
      verdict: overlay.verdict,
      basis: overlay.basis,
      policy: overlay.policy ?? null,
      displaced: overlay.displaced ?? [],
      displacedNote:
        (overlay.displaced ?? []).length === 0
          ? "no file the patch wrote was displaced by the overlay"
          : `the patch wrote ${overlay.displaced.join(", ")} and the overlay displaced it: the project-test result of this reading is the overlaid tree's, not the delivered tree's`,
      detail: (overlay.detail ?? "").slice(-3000),
    },
    host: {
      hostname: hostname(),
      platform: process.platform,
      node: process.version,
      wallMs: Date.now() - started,
    },
    scoredAt: new Date().toISOString(),
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]).endsWith("rescore.mjs")) {
  const args = parseArguments(process.argv.slice(2));
  for (const name of ["stage", "task", "arm"])
    if (!args.has(name))
      throw new Error(
        "usage: rescore.mjs --stage <directory> --task <id> --arm swarm|opencode [--patch <file>] [--out <json>]",
      );
  const result = await rescore({
    stage: resolve(args.get("stage")),
    taskId: args.get("task"),
    arm: args.get("arm"),
    patchFile: args.get("patch"),
    blobs: args.get("blobs") ?? join(comparisonRoot, "blobs"),
  });
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (args.has("out")) writeFileSync(args.get("out"), text);
  console.log(text);
}
