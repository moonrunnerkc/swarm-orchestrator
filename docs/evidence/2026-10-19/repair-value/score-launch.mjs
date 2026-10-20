#!/usr/bin/env node
/**
 * Every candidate of one finished launch, rebuilt from the launch's own records and scored
 * externally, and what repair did to correctness in that run. Evaluation only: it runs after the
 * product has delivered, nothing it finds reaches the product or a model, and it never decides
 * what the product delivered.
 *
 * A candidate is the tree one model loop left, the first implementation's or a repair's. The
 * product records no candidate's bytes, only the tree its checks pinned (`goal-check` records),
 * so each is rebuilt and kept only where its tree is that one:
 *
 * 1. the tree the stage started from, with the stage's recorded `edit` and `write` calls applied
 *    in order (a shell command's effect on a file is not a tool call, so it is missing here);
 * 2. for a rolled-back candidate, the files its `rejected-candidate-v1` record keeps (the evidence
 *    scrubber can redact a credential-shaped token in them, which this check catches);
 * 3. for a kept candidate, the change the next repair's brief carries as its diff against the base;
 * 4. for the last kept candidate, the run's `workspace-diff` record;
 * 5. the base tree itself, for a repair that undid the whole change.
 *
 * A candidate none of these rebuilds is reported as not recovered, with its pinned tree, and is
 * not scored. The tree each stage starts from is the last kept candidate's, as the ratchet's own
 * decisions say.
 *
 *   node score-launch.mjs --launch <dir> --out <dir>
 *
 * `<dir>` holds the driver's `summary.json`, `exchanges.json` and the worker session's
 * `<session>.ledger.jsonl` and `<session>.blobs/`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import {
  cloneAtBase,
  comparisonRoot,
  excludedFromPatch,
  resolveFull,
  workRoot,
} from "../../../../scripts/comparison/workspace.mjs";
import { tasks } from "../../../../scripts/pilot/tasks-2026-10-17.mjs";
import { loadLedger, stageBoundaries, stageUsage } from "./candidates.mjs";

const { values } = parseArgs({ options: { launch: { type: "string" }, out: { type: "string" } } });
if (values.launch === undefined || values.out === undefined)
  throw new Error("usage: score-launch.mjs --launch <dir> --out <dir>");
const launch = resolve(values.launch);
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`${out} is not empty; a record is never overwritten`);

const summary = JSON.parse(readFileSync(join(launch, "summary.json"), "utf8"));
const task = tasks.find((one) => one.id === summary.task);
const worker = summary.sessions.find((one) => !one.endsWith("-plan"));
const records = loadLedger(join(launch, `${worker}.ledger.jsonl`));
const exchanges = JSON.parse(readFileSync(join(launch, "exchanges.json"), "utf8"));
const log = commandLog(join(comparisonRoot, "blobs"));
const { base } = await resolveFull(log, task);
const scratch = mkdtempSync(join(workRoot, "score-launch-"));
const checkout = join(scratch, "checkout");
await cloneAtBase(log, task, base, checkout);
const git = (args, input) => spawnSync("git", args, { cwd: checkout, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// A candidate as files changed against the base: path -> content, or null for a removed file.
const reset = () => {
  git(["checkout", "--quiet", "--", "."]);
  git(["clean", "-fdq"]);
  mkdirSync(dirname(join(checkout, task.visible.path)), { recursive: true });
  writeFileSync(join(checkout, task.visible.path), task.visible.source);
};
const materialize = (files) => {
  reset();
  for (const [path, content] of files) {
    const target = join(checkout, path);
    if (content === null) rmSync(target, { force: true });
    else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  }
};
const treeOf = (files) => {
  materialize(files);
  git(["add", "--all", "--force", task.visible.path]);
  git(["add", "--all"]);
  const tree = git(["write-tree"]).stdout.trim();
  git(["reset", "--quiet"]);
  return tree;
};
const readFile = (path) => {
  try {
    return readFileSync(join(checkout, path), "utf8");
  } catch {
    return null;
  }
};
// The change a candidate is, against the base, as the evaluator reads a delivered patch.
const patchOf = (files) => {
  materialize(files);
  git(["add", "--all"]);
  const patch = git(["diff", "--cached", "--binary", "--", ".", ...excludedFromPatch.map((one) => `:!${one}`)]).stdout;
  git(["reset", "--quiet"]);
  return patch;
};
// The files a patch against the base changes, read back after applying it.
const filesFromPatch = (patch, zeroContext) => {
  reset();
  const applied = git(["apply", ...(zeroContext ? ["--unidiff-zero"] : []), "-"], patch.endsWith("\n") ? patch : `${patch}\n`);
  if (applied.status !== 0) return null;
  const paths = [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((match) => match[2]);
  return new Map(paths.map((path) => [path, readFile(path)]));
};

const stages = stageBoundaries(records);
const pinned = (stage) => [
  ...new Set(
    records
      .filter((one) => one.type === "goal-check" && one.sequence > stage.gatesFrom && one.sequence <= stage.gatesTo)
      .map((one) => one.payload.tree),
  ),
];
const ratchetOf = (attempt) =>
  records.find((one) => one.type === "ratchet-decision" && one.payload.scope === "retry" && one.payload.attempt === attempt)?.payload ?? null;
const briefs = exchanges.records
  .filter((one) => one.method === "POST" && Array.isArray(one.request?.messages))
  .map((one) => exchanges.messages[one.request.messages[1]]?.content)
  .filter((text) => typeof text === "string" && /This is attempt \d+ of \d+\./.test(text));
const briefDiff = (attempt) => {
  const brief = briefs.find((text) => text.includes(`This is attempt ${attempt} of `));
  const marker = "the files you read already hold the + lines):\n";
  if (brief === undefined || !brief.includes(marker)) return null;
  const from = brief.indexOf(marker) + marker.length;
  return brief.slice(from, brief.indexOf("\nThe workspace is in the state", from));
};
const finalDiff = records.filter((one) => one.type === "workspace-diff").at(-1)?.payload?.patch ?? null;

let retained = new Map();
const rows = [];
for (const [index, stage] of stages.entries()) {
  const want = pinned(stage);
  const ratchet = ratchetOf(stage.attempt);
  const kept = stage.attempt === 0 || ratchet?.accepted === true;
  const tried = [];
  let recovered = null;
  // 1. the stage's recorded file edits over the tree it started from
  const edited = new Map(retained);
  materialize(edited);
  for (const record of records.filter((one) => one.sequence > stage.startedAfter && one.sequence <= stage.stoppedAt)) {
    const call = record.payload;
    if (record.type !== "tool-call" || call?.decision !== "allowed" || typeof call.input?.path !== "string") continue;
    if (call.toolName === "edit" && /^replaced \d+ occurrence/.test(call.output ?? "")) {
      const before = edited.has(call.input.path) ? edited.get(call.input.path) : readFile(call.input.path);
      if (before === null) continue;
      edited.set(
        call.input.path,
        call.input.replaceAll === true
          ? before.split(call.input.find).join(call.input.replace)
          : before.replace(call.input.find, () => call.input.replace),
      );
    }
    if (call.toolName === "write" && !/^failed|^denied/.test(call.output ?? "")) edited.set(call.input.path, call.input.content);
  }
  const candidates = [["tool calls", edited]];
  // 2. a rolled-back candidate's kept files
  if (!kept) {
    const record = records.find((one) => one.payload?.rule === "rejected-candidate-v1" && one.payload.attempt === stage.attempt);
    if (record !== undefined)
      candidates.push([
        "rejected-candidate record",
        new Map([...retained, ...record.payload.files.map((file) => [file.path, file.truncated ? undefined : file.contents])]),
      ]);
  }
  // 3. a kept candidate is the change the next repair was briefed with
  if (kept) {
    const diff = briefDiff(stage.attempt + 1);
    const files = diff === null ? null : filesFromPatch(diff, true);
    if (files !== null) candidates.push(["next repair's brief", files]);
  }
  // 4. the last kept candidate is the run's delivered change
  if (kept && finalDiff !== null && !stages.slice(index + 1).some((later) => ratchetOf(later.attempt)?.accepted === true)) {
    const files = filesFromPatch(finalDiff, true);
    if (files !== null) candidates.push(["workspace-diff record", files]);
  }
  // 5. a repair that undid the whole change left the base itself
  candidates.push(["the base tree", new Map()]);
  for (const [source, files] of candidates) {
    if ([...files.values()].includes(undefined)) {
      tried.push({ source, outcome: "truncated" });
      continue;
    }
    const tree = treeOf(files);
    tried.push({ source, tree });
    if (want.length === 1 && tree === want[0]) {
      recovered = { source, files };
      break;
    }
  }
  const patch = recovered === null ? null : patchOf(recovered.files);
  if (patch !== null) {
    mkdirSync(join(out, "candidates"), { recursive: true });
    writeFileSync(join(out, "candidates", `${stage.name}.patch`), patch);
  }
  rows.push({
    stage: stage.name,
    attempt: stage.attempt,
    pinnedTree: want.length === 1 ? want[0] : want,
    recovered: recovered === null ? null : recovered.source,
    tried,
    patch: patch === null ? null : `candidates/${stage.name}.patch`,
    ratchet: ratchet === null ? null : { accepted: ratchet.accepted, detail: ratchet.detail },
    keptByProduct: kept,
    model: stageUsage(records, stage),
  });
  if (kept && recovered !== null) retained = new Map(recovered.files);
}

// The external scores, apart, on every recovered candidate.
const scored = spawnSync(
  process.execPath,
  [new URL("./score-candidates.mjs", import.meta.url).pathname, "--candidates", join(out, "candidates"), "--out", join(out, "scores")],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (scored.status !== 0) throw new Error(`scoring failed: ${scored.stderr.slice(-800)}`);
const scores = JSON.parse(readFileSync(join(out, "scores", "scores.json"), "utf8")).rows;
const scoreOf = (name) => scores.find((one) => one.candidate === name) ?? null;
const correct = (name) => {
  const score = scoreOf(name);
  return score === null ? null : score.expandedPasses;
};

// What repair did: each repair against the tree it started from, by the external reading.
let from = "attempt-0";
const transitions = [];
for (const row of rows.slice(1)) {
  const before = correct(from);
  const after = correct(row.stage);
  const sameTree = rows.find((one) => one.stage === from)?.pinnedTree === row.pinnedTree;
  transitions.push({
    repair: row.stage,
    startedFrom: from,
    before,
    after,
    kind:
      before === null || after === null
        ? "unknown (a candidate was not recovered)"
        : sameTree
          ? "no change: the repair left the tree as it was"
          : before === after
            ? before
              ? "correct to correct"
              : "incorrect to incorrect"
            : after
              ? "incorrect to correct"
              : "correct to incorrect",
    keptByProduct: row.keptByProduct,
  });
  if (row.keptByProduct) from = row.stage;
}
const delivered = from;
const repairUsage = rows.slice(1).reduce(
  (sum, row) => ({
    calls: sum.calls + row.model.calls,
    inputTokens: sum.inputTokens + row.model.inputTokens,
    outputTokens: sum.outputTokens + row.model.outputTokens,
    responseMs: sum.responseMs + row.model.responseMs,
    loopWallMs: sum.loopWallMs + row.model.loopWallMs,
  }),
  { calls: 0, inputTokens: 0, outputTokens: 0, responseMs: 0, loopWallMs: 0 },
);
const finalPatch = (() => {
  try {
    return readFileSync(join(launch, "final.patch"), "utf8");
  } catch {
    return null;
  }
})();
const result = {
  schema: "swarm-launch-repair-value.v1",
  kind: "external evaluation after the launch finished; never given to the product",
  task: task.id,
  baseCommit: base,
  session: worker,
  rows,
  correctness: "a candidate is correct where the frozen evaluator passes and the custom-extension check passes",
  firstCandidate: { stage: "attempt-0", correct: correct("attempt-0"), score: scoreOf("attempt-0") },
  deliveredCandidate: {
    stage: delivered,
    correct: correct(delivered),
    score: scoreOf(delivered),
    matchesDriverFinalPatch:
      finalPatch === null || scoreOf(delivered) === null
        ? null
        : readFileSync(join(out, "candidates", `${delivered}.patch`), "utf8") === finalPatch,
  },
  transitions,
  counts: {
    repairs: transitions.length,
    incorrectToCorrect: transitions.filter((one) => one.kind === "incorrect to correct").length,
    correctToIncorrect: transitions.filter((one) => one.kind === "correct to incorrect").length,
    noRelevantChange: transitions.filter((one) => one.kind.startsWith("no change") || one.kind === "incorrect to incorrect" || one.kind === "correct to correct").length,
    unknown: transitions.filter((one) => one.kind.startsWith("unknown")).length,
  },
  repairUsage,
  scratch,
};
writeFileSync(join(out, "repair-value.json"), `${JSON.stringify(result, null, 2)}\n`);
console.table(rows.map((row) => ({ stage: row.stage, recovered: row.recovered ?? "NOT RECOVERED", kept: row.keptByProduct, correct: correct(row.stage) })));
console.log(JSON.stringify({ first: result.firstCandidate.correct, delivered: result.deliveredCandidate, counts: result.counts, repairUsage }, null, 1));
