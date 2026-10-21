#!/usr/bin/env node
/**
 * Swarm's first candidate rebuilt from its own ledger, with no model: a fresh checkout of the base
 * with the visible check committed, as the runner prepares a launch, and every allowed `write` and
 * `edit` the first loop recorded before its stop, applied by the edit tool's own rule (one
 * occurrence, or every one under `replaceAll`), with a shell `git checkout` or `git restore` of
 * named paths replayed as the restore it is. The tree's zero-context diff is digested as the
 * product digests it and held to the `sourcePatchDigest` of the first independent verification
 * after that stop, which measured the same tree. Only a match is a reconstruction: a shell
 * command that wrote files, or any other effect the replay cannot repeat, shows up as a mismatch
 * and the candidate is reported as not reconstructed, never as scored.
 *
 *   node reconstruct-first.mjs --manifest <stage manifest.json> --task <id> --session <ledger dir> --out <dir>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import {
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  workRoot,
} from "../../../../scripts/comparison/workspace.mjs";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    task: { type: "string" },
    session: { type: "string" },
    out: { type: "string" },
  },
});
for (const name of ["manifest", "task", "session", "out"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
const out = resolve(values.out);
if (existsSync(join(out, "first.json"))) throw new Error(`${out}/first.json exists; a record is never overwritten`);
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf8"));
const task = manifest.tasks.find((one) => one.id === values.task);
if (task === undefined) throw new Error(`${values.task} is not in the manifest`);
const session = resolve(values.session);
const records = readFileSync(join(session, "ledger.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const payload = (record) => {
  const path = join(session, "blobs", `${record.payloadDigest.slice(7)}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
};
const digestOf = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "core.abbrev=7", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const firstStop = records.find((record) => record.type === "session-stopped");
if (firstStop === undefined) throw new Error("the ledger records no loop stop");
const measured = records.find(
  (record) => record.type === "independent-verification" && record.sequence > firstStop.sequence,
);
const expected = measured === undefined ? null : payload(measured)?.sourcePatchDigest ?? null;

/** The paths of `git checkout [--] <paths>` or `git restore <paths>`, alone, or null. */
function restoredPaths(command) {
  const match = /^\s*git (?:checkout(?: --)?|restore) ((?:[\w./-]+ ?)+?)\s*(?:2>&1)?\s*$/.exec(command);
  if (match === null) return null;
  const paths = match[1].trim().split(/\s+/);
  return paths.some((path) => path.startsWith("-") || path === ".") ? null : paths;
}

const log = commandLog(join(comparisonRoot, "blobs"));
mkdirSync(workRoot, { recursive: true });
const tree = join(mkdtempSync(join(workRoot, `reconstruct-${task.id}-`)), "checkout");
await cloneAtBase(log, task, task.baseCommit, tree);
await commitVisibleCheck(log, task, tree);

const applied = [];
const shellCalls = [];
let failure = null;
for (const record of records) {
  if (record.sequence >= firstStop.sequence || record.type !== "tool-call") continue;
  const call = payload(record);
  if (call === undefined || call.decision !== "allowed") continue;
  if (call.toolName === "shell") {
    // A restore of named paths from the checkout's commit is the one shell effect replayed: what
    // it writes is fully determined. Every other shell command is listed, and any file it wrote
    // shows up as a digest mismatch.
    const restore = restoredPaths(call.input?.command ?? "");
    if (restore !== null && call.facts?.exitCode === 0) {
      git(tree, "checkout", "HEAD", "--", ...restore);
      applied.push(`${record.sequence}: shell restore ${restore.join(" ")}`);
    } else shellCalls.push({ sequence: record.sequence, command: call.input?.command ?? null });
    continue;
  }
  if (call.toolName !== "write" && call.toolName !== "edit") continue;
  const path = join(tree, call.input.path);
  if (call.toolName === "write") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, call.input.content);
    applied.push(`${record.sequence}: write ${call.input.path}`);
    continue;
  }
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const occurrences = before.split(call.input.find).length - 1;
  if (occurrences === 0 || (occurrences > 1 && call.input.replaceAll !== true)) {
    failure = `${record.sequence}: edit of ${call.input.path} matched ${occurrences} time(s)`;
    break;
  }
  writeFileSync(
    path,
    call.input.replaceAll === true
      ? before.split(call.input.find).join(call.input.replace)
      : before.replace(call.input.find, () => call.input.replace),
  );
  applied.push(`${record.sequence}: edit ${call.input.path}`);
}

git(tree, "add", "-A");
const head = git(tree, "rev-parse", "HEAD").trim();
const diff = git(tree, "diff", "--no-color", "--no-ext-diff", "--unified=0", "--cached", head, "--");
const patch = git(tree, "diff", "--no-color", "--no-ext-diff", "--binary", "--full-index", "--cached", head, "--");
const digest = digestOf(diff);
const reconstructed = failure === null && expected !== null && digest === expected;
if (reconstructed) writeFileSync(join(out, "first.patch"), patch);
const result = {
  task: task.id,
  firstStop: { sequence: firstStop.sequence, stopReason: payload(firstStop)?.stopReason ?? null },
  measuredBy: measured === undefined ? null : { sequence: measured.sequence, sourcePatchDigest: expected },
  applied,
  shellCallsNotReplayed: shellCalls,
  replayFailure: failure,
  digest,
  reconstructed,
  patchDigest: reconstructed ? digestOf(patch) : null,
};
writeFileSync(join(out, "first.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ task: task.id, reconstructed, digest, expected, failure }));
