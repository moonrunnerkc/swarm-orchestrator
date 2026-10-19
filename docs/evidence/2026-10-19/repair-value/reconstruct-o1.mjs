#!/usr/bin/env node
/**
 * Every candidate of 2026-10-18 ordinary launch O1, rebuilt from its own packed records with no
 * model: the first implementation and each repair, each bound to the blob of the file it left and
 * to the digest of its patch against the original base, beside what the product recorded about it
 * (the supplied check, every generated check apart, the brief the next repair was given, the
 * ratchet's decision and the tree it kept, and the model calls the stage made).
 *
 * The files come from the recorded tool calls, applied in ledger order to the base's
 * `src/Mime.ts`; repair 3's file comes from its own recorded `git diff` (it also ran the project's
 * formatter, whose edit is not a tool call), and its seven other formatted files from running the
 * same formatter command on a prepared checkout. Each rebuilt file is checked against the blob
 * the product recorded for it. Nothing here scores a candidate: `score-candidates.mjs` does that,
 * apart, and nothing it finds is given to the product.
 *
 *   node reconstruct-o1.mjs --out <dir>
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import { unpackArchive } from "../../../../scripts/local-campaign/archive.mjs";
import {
  cloneAtBase,
  comparisonRoot,
  prepare,
  resolveFull,
  taskEnvironment,
  workRoot,
} from "../../../../scripts/comparison/workspace.mjs";
import { tasks } from "../../../../scripts/pilot/tasks-2026-10-17.mjs";
import { candidatePatch, loadLedger, stageBoundaries, stageUsage } from "./candidates.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (values.out === undefined) throw new Error("usage: reconstruct-o1.mjs --out <dir>");
const out = values.out;
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`${out} is not empty; a record is never overwritten`);

const task = tasks.find((one) => one.id === "mime-bugfix-gettype-line-terminators");
const log = commandLog(join(comparisonRoot, "blobs"));
const { base } = await resolveFull(log, task);
const pack = await unpackArchive(
  new URL("../../2026-10-18/checking-semantics/packed-derived/launch-streams", import.meta.url).pathname,
);
const launch = join(pack.directory, "launch-o1");
const records = loadLedger(join(launch, "20261019T004042-a05716.ledger.jsonl"));
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const blobOf = (text) => execFileSync("git", ["hash-object", "--stdin"], { input: text }).toString().trim();
const baseFile = spawnSync("git", ["show", `${base}:src/Mime.ts`], {
  cwd: join(comparisonRoot, "mirrors", "broofa__mime.git"),
  encoding: "utf8",
}).stdout;

// The file after each stage: the recorded edit and write calls the guard allowed, in order.
const stages = stageBoundaries(records);
let text = baseFile;
const fileAfter = new Map();
for (const record of records) {
  const call = record.payload;
  if (record.type === "tool-call" && call.decision === "allowed" && call.input?.path === "src/Mime.ts") {
    if (call.toolName === "edit") {
      const matches = text.split(call.input.find).length - 1;
      if (matches !== 1) throw new Error(`sequence ${record.sequence}: the recorded edit matches ${matches} times`);
      text = text.replace(call.input.find, () => call.input.replace);
    }
    if (call.toolName === "write") text = call.input.content;
  }
  const stage = stages.find((one) => one.stoppedAt === record.sequence);
  if (stage !== undefined) fileAfter.set(stage.name, text);
}

// Repair 3 also ran `npx prettier --write src/Mime.ts` and `npx prettier --write .`; its file is
// what its own last `git diff src/Mime.ts` (sequence 875) shows, applied to the base.
const recordedDiff = records.find((one) => one.sequence === 875).payload.output;
const scratch = mkdtempSync(join(workRoot, "reconstruct-o1-"));
const checkout = join(scratch, "checkout");
await cloneAtBase(log, task, base, checkout);
const applied = spawnSync("git", ["apply", "-"], {
  cwd: checkout,
  input: `${recordedDiff.slice(recordedDiff.indexOf("diff --git"))}\n`,
  encoding: "utf8",
});
if (applied.status !== 0) throw new Error(`repair 3's recorded diff does not apply: ${applied.stderr}`);
fileAfter.set("repair-3", readFileSync(join(checkout, "src/Mime.ts"), "utf8"));
// Its other files: the same formatter command, on a prepared checkout holding its Mime.ts.
const prepared = await prepare(log, task, checkout);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);
const formatted = spawnSync("npx", ["prettier", "--write", "."], {
  cwd: checkout,
  env: taskEnvironment(task),
  encoding: "utf8",
});
if (formatted.status !== 0) throw new Error(`the formatter failed: ${formatted.stderr}`);
const repair3Patch = spawnSync("git", ["diff", "--binary"], { cwd: checkout, encoding: "utf8" }).stdout;
const repair3Files = [...repair3Patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
const fileSetGate = records.find((one) => one.sequence === 889).payload;
const recordedOutside = JSON.parse(fileSetGate.stdout).outside;

// The blob each stage's file must be, as the product recorded it.
const recordedBlob = {
  "attempt-0": "54e61a8", // the first repair brief's diff header (exchange 35)
  "repair-1": "a88e54b", // the third repair brief and the delivered workspace-diff record
  "repair-2": "a88e54b",
  "repair-3": "c66bacc", // repair 3's own last git diff (sequence 875)
};

// The tree the product's checks pinned for a candidate: the workspace base (the original base
// with the visible check) and the candidate's patch, staged whole and written.
const rebuiltTree = async (name, patch) => {
  const directory = join(scratch, `tree-${name}`);
  await cloneAtBase(log, task, base, directory);
  mkdirSync(dirname(join(directory, task.visible.path)), { recursive: true });
  writeFileSync(join(directory, task.visible.path), task.visible.source);
  const git = (args, input) => spawnSync("git", args, { cwd: directory, input, encoding: "utf8" });
  if (git(["apply", "-"], patch).status !== 0) throw new Error(`${name}: the patch does not apply`);
  git(["add", "--all", "--force", task.visible.path]);
  git(["add", "--all"]);
  return git(["write-tree"]).stdout.trim();
};

const gateRuns = records.filter((one) => one.type === "gate-run");
const ratchets = records.filter((one) => one.type === "ratchet-decision");
const rows = [];
for (const stage of stages) {
  const file = fileAfter.get(stage.name);
  const blob = blobOf(file);
  if (!blob.startsWith(recordedBlob[stage.name]))
    throw new Error(`${stage.name}: rebuilt blob ${blob} is not the recorded ${recordedBlob[stage.name]}`);
  const patch =
    stage.name === "repair-3" ? repair3Patch : candidatePatch(baseFile, file, "src/Mime.ts");
  mkdirSync(join(out, "candidates"), { recursive: true });
  writeFileSync(join(out, "candidates", `${stage.name}.patch`), patch);
  const runs = gateRuns.filter((one) => one.payload.attempt === stage.attempt);
  const diagnostics = runs.find((one) => one.payload.gateId === "task-diagnostics")?.payload;
  const findings = JSON.parse(diagnostics.stdout).findings;
  const trees = records
    .filter((one) => one.type === "goal-check" && one.sequence > stage.gatesFrom && one.sequence <= stage.gatesTo)
    .map((one) => one.payload.tree);
  const ratchet = ratchets.find((one) => one.payload.scope === "retry" && one.payload.attempt === stage.attempt);
  const recordedTrees = [...new Set(trees)];
  const rebuilt = await rebuiltTree(stage.name, patch);
  if (recordedTrees.length !== 1 || recordedTrees[0] !== rebuilt)
    throw new Error(`${stage.name}: rebuilt tree ${rebuilt} is not the recorded ${recordedTrees.join(", ")}`);
  rows.push({
    stage: stage.name,
    attempt: stage.attempt,
    file: { path: "src/Mime.ts", blob, recordedBlob: recordedBlob[stage.name] },
    patch: {
      file: `candidates/${stage.name}.patch`,
      digest: digest(patch),
      files: [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]),
      ...(stage.name === "repair-3"
        ? {
            reconstruction:
              "src/Mime.ts from the recorded git diff; the other files by rerunning the recorded formatter command",
            otherFilesMatchRecordedFileSetGate:
              JSON.stringify(repair3Files.filter((one) => one !== "src/Mime.ts").sort()) ===
              JSON.stringify([...recordedOutside].sort()),
          }
        : {}),
    },
    workspaceTree: { recorded: recordedTrees[0], rebuilt, matches: true },
    suppliedCheck: findings.find((one) => one.id === "visible-check"),
    generatedChecks: findings.filter((one) => one.id !== "visible-check"),
    diagnosticsBrief: diagnostics.stderr,
    gates: Object.fromEntries(runs.map((one) => [one.payload.gateId, one.payload.status])),
    ratchet:
      ratchet === undefined
        ? null
        : { accepted: ratchet.payload.accepted, detail: ratchet.payload.detail, parts: ratchet.payload.parts },
    model: stageUsage(records, stage),
  });
}

const result = {
  schema: "swarm-o1-candidates.v1",
  task: task.id,
  baseCommit: base,
  launch: "docs/evidence/2026-10-18/checking-semantics/launch-o1",
  session: "20261019T004042-a05716",
  node: process.version,
  rows,
  scratch,
};
writeFileSync(join(out, "o1-candidates.json"), `${JSON.stringify(result, null, 2)}\n`);
console.table(
  rows.map((row) => ({
    stage: row.stage,
    blob: row.file.blob.slice(0, 7),
    patch: row.patch.digest.slice(0, 19),
    diagnostics: row.generatedChecks.map((one) => one.status[0]).join(""),
    ratchet: row.ratchet === null ? "-" : row.ratchet.accepted ? "kept" : "rolled back",
    tokens: row.model.inputTokens + row.model.outputTokens,
  })),
);
await pack.dispose();
