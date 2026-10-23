// Rebuilds every published candidate of the October 23 controller stage's two refactor tasks from
// its records and runs the product's independent verification over it, with the sealed goal
// contract the Swarm runs used, so a build's verdicts can be compared with the published ones and
// with each candidate's hidden verdict.
//
// usage: node reproduce-refusals.mjs --cli <swarm cli> --sessions <archive root> --out <directory>
//        [--task markdown-it|fastify] [--only <record file name>]
//
// The archive root holds docs/evidence/2026-10-23-controller/sessions/controller-stage-sessions.tar.xz
// (branch evidence/2026-10-23-controller-sessions) extracted as it is, and, from
// docs/evidence/2026-10-22-adaptive/sessions/adaptive-stage-sessions.tar.xz (branch
// evidence/2026-10-22-adaptive-sessions), the one file
// swarm-study-2026-10-22/heldout-inputs/fastify-refactor-kebab-case-file-names/package-lock.json:
// fastify's base commits no lockfile, so the study committed the one it froze beside the visible
// check, and this does the same. The repository mirrors are the comparison's
// (~/.cache/swarm-comparison/mirrors), or a public clone of each repository.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const evidenceRoot = resolve(here, "..");

const groups = {
  "markdown-it": {
    tasks: join(evidenceRoot, "2026-10-23-controller/fresh/sealed/heldout-tasks.mjs"),
    taskId: "markdown-it-refactor-ts-file-extensions",
    runs: "swarm-study-2026-10-23/fresh-2/runs",
    contractSession: "markdown-it-refactor-ts-file-extensions.swarm",
  },
  fastify: {
    tasks: join(evidenceRoot, "2026-10-22-adaptive/heldout/sealed/heldout-tasks.mjs"),
    taskId: "fastify-refactor-kebab-case-file-names",
    runs: "swarm-study-2026-10-23/dev/runs",
    contractSession: "fastify-refactor-kebab-case-file-names.swarm-previous",
    manifest: "swarm-study-2026-10-23/dev/manifest.json",
    lockfileRoot: "swarm-study-2026-10-22/heldout-inputs",
  },
};

const { values } = parseArgs({
  options: {
    cli: { type: "string" },
    sessions: { type: "string" },
    out: { type: "string" },
    task: { type: "string" },
    only: { type: "string" },
    mirrors: { type: "string", default: join(homedir(), ".cache/swarm-comparison/mirrors") },
  },
});
if (!values.cli || !values.sessions || !values.out)
  throw new Error("usage: --cli <swarm cli> --sessions <archive root> --out <directory>");

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function run(argv, cwd) {
  const ran = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false" },
  });
  if (ran.error) throw ran.error;
  return ran;
}

function must(argv, cwd) {
  const ran = run(argv, cwd);
  if (ran.status !== 0)
    throw new Error(`${argv.join(" ")} exited ${ran.status}:\n${ran.stderr.slice(-2000)}`);
  return ran;
}

const commit = (workspace, message) =>
  must(
    [
      "git",
      "-c",
      "user.name=comparison",
      "-c",
      "user.email=comparison@localhost",
      "commit",
      "-qm",
      message,
    ],
    workspace,
  );

function payloads(sessionDirectory, type) {
  const found = [];
  for (const line of readFileSync(join(sessionDirectory, "ledger.jsonl"), "utf8").split("\n")) {
    if (line.length === 0) continue;
    const record = JSON.parse(line);
    if (record.type !== type) continue;
    const blob = join(sessionDirectory, "blobs", `${record.payloadDigest.slice("sha256:".length)}.json`);
    found.push({ sequence: record.sequence, payload: JSON.parse(readFileSync(blob, "utf8")) });
  }
  return found;
}

/** The status each repository check carried, by id, read from one verification payload. */
function checkStatuses(verification) {
  return Object.fromEntries(
    (verification?.checks ?? []).map((check) => [
      check.id,
      {
        status: check.status,
        reported: check.reportedStatus ?? null,
        configurationFiles: check.configurationFiles ?? [],
        weakenedTests: (check.weakenedTests ?? []).length,
        transported: (check.instrument?.transport?.renames ?? []).length,
        baseTestsTransported: (check.baseTestsTransported ?? []).length,
      },
    ]),
  );
}

/** One prepared base per task, as the study prepared it: the visible check and lockfile committed. */
function prepare(group, task, root) {
  const workspace = join(root, "workspace");
  if (existsSync(workspace)) return workspace;
  mkdirSync(root, { recursive: true });
  const mirror = join(values.mirrors, `${task.repository.replace("/", "__")}.git`);
  must(["git", "clone", "--quiet", "--no-checkout", mirror, workspace], root);
  must(["git", "checkout", "--quiet", "-b", "work", task.baseCommit], workspace);
  must(["git", "remote", "remove", "origin"], workspace);
  mkdirSync(dirname(join(workspace, task.visible.path)), { recursive: true });
  writeFileSync(join(workspace, task.visible.path), task.visible.source);
  must(["git", "add", "--force", task.visible.path], workspace);
  commit(workspace, "Visible acceptance check for the task");
  const frozen =
    group.manifest === undefined
      ? undefined
      : JSON.parse(readFileSync(join(values.sessions, group.manifest), "utf8")).harnessLockfiles?.[
          task.id
        ];
  if (frozen !== undefined) {
    const bytes = readFileSync(join(values.sessions, group.lockfileRoot, frozen.name));
    if (sha256(bytes) !== frozen.digest)
      throw new Error(`${task.id}: the frozen lockfile does not match the manifest's digest`);
    writeFileSync(join(workspace, "package-lock.json"), bytes);
    must(["git", "add", "--force", "package-lock.json"], workspace);
    commit(workspace, "Lockfile the harness resolved for the task's base");
  }
  for (const argv of task.install) must(argv, workspace);
  return workspace;
}

mkdirSync(values.out, { recursive: true });
const summaryPath = join(values.out, "summary.json");
const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : [];
for (const [name, group] of Object.entries(groups)) {
  if (values.task !== undefined && values.task !== name) continue;
  const { tasks } = await import(group.tasks);
  const task = tasks.find((one) => one.id === group.taskId);
  const runs = join(values.sessions, group.runs);
  const contractSession = join(runs, "sessions", group.contractSession);
  const contract = payloads(contractSession, "goal-contract")[0]?.payload.contract;
  if (contract === undefined) throw new Error(`${contractSession} records no goal contract`);
  const root = join(values.out, name);
  const workspace = prepare(group, task, root);
  writeFileSync(join(root, "contract.json"), `${JSON.stringify(contract, null, 2)}\n`);
  const records = readdirSync(runs)
    .filter((file) => file.startsWith(task.id) && /\.json$/.test(file) && !/setup-\d/.test(file))
    .filter((file) => values.only === undefined || values.only === file)
    .sort();
  for (const file of records) {
    const record = JSON.parse(readFileSync(join(runs, file), "utf8"));
    if (record.finalPatchDigest === undefined) continue;
    const patch = readFileSync(join(runs, "blobs", record.finalPatchDigest.slice("sha256:".length)));
    if (sha256(patch) !== record.finalPatchDigest)
      throw new Error(`${file}: the patch blob does not match the record's digest`);
    const candidate = join(root, file.replace(/\.json$/, ""));
    mkdirSync(candidate, { recursive: true });
    writeFileSync(join(candidate, "candidate.patch"), patch);
    const verified = run(
      [
        process.execPath,
        resolve(values.cli),
        "ci",
        "--workspace",
        workspace,
        "--patch",
        join(candidate, "candidate.patch"),
        "--base",
        "HEAD",
        "--goal-contract",
        join(root, "contract.json"),
        "--install",
        "--lockfile",
        "package-lock.json",
        "--json",
      ],
      workspace,
    );
    writeFileSync(join(candidate, "ci.stdout.json"), verified.stdout);
    writeFileSync(join(candidate, "ci.stderr.txt"), verified.stderr);
    const result = JSON.parse(verified.stdout.trim().split("\n").at(-1) || "{}");
    const session = record.evidence === undefined ? null : join(runs, "sessions", file.replace(/\.json$/, ""));
    const published =
      session !== null && existsSync(join(session, "ledger.jsonl"))
        ? payloads(session, "independent-verification")
            .filter((one) => (one.payload.checks ?? []).length > 0)
            .at(-1)
        : undefined;
    const entry = {
      task: task.id,
      record: file,
      arm: record.arm,
      sample: record.sample,
      patchDigest: record.finalPatchDigest,
      hidden: record.scores?.hidden?.verdict ?? null,
      productAcceptable: record.invocation?.productVerdict?.acceptable ?? null,
      published:
        published === undefined
          ? null
          : {
              sequence: published.sequence,
              task: published.payload.task,
              regression: published.payload.regression,
              verified: published.payload.verified,
              checks: checkStatuses(published.payload),
            },
      reproduced: {
        exitCode: verified.status,
        task: result.task ?? null,
        regression: result.regression ?? null,
        verified: result.verified ?? null,
        checks: checkStatuses(result),
        advice: result.advice ?? null,
      },
    };
    const at = summary.findIndex((one) => one.record === file);
    if (at === -1) summary.push(entry);
    else summary[at] = entry;
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(
      `${file}: hidden ${entry.hidden}, reproduced task ${entry.reproduced.task}, regression ${entry.reproduced.regression}, verified ${entry.reproduced.verified}`,
    );
  }
}
