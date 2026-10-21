// Launch 1 of the development trial, replayed through the product's real controller over the
// real sinon tree, with the model replaced by the launch's own recorded edits. No model.
//
// The tree is a clone of the base with the task's visible check committed on top, as the runner
// prepares a launch, installed from the base's lockfile. The first loop's recorded edits are
// applied, the three files the launch declared are declared, and the gates engine runs exactly
// as a run's does: the sealed gate set from the project's manifest with the tests gate the
// comparison configures (npm run test-node) and the contract's acceptance gate (the visible
// check judged in a fresh checkout), the first cycle, the measurement of its failures at the
// base, one resolve attempt whose "model" replays repair attempt 1's recorded edits, the
// candidate's cycle, the ratchet, the base comparison, the bonds, and the run assessment.
//
// Two modes. `replay` applies the repair as recorded and expects the corrected assertion measure
// (refute counted, commit 643b9ef4c) to keep the candidate: the final cycle is attempt 1's, the
// workspace holds the repaired tree (zero-context diff sha256:737535fd...), the assessment is
// acceptable. `weakened` applies the same repair and then deletes one of the nine test cases it
// added, a genuinely weakened suite the ratchet must reject: the workspace is put back to the
// first candidate (sha256:c5a77e64...) and the run is refused.
//
// Replay shortcuts, named: the model is the recorded edits (attempt 2 is never asked for, so a
// rejected attempt 1 ends the attempts); the loop's own stop is given to the assessment as the
// record says it was (max-steps); the clone is from a full mirror rather than the runner's shallow
// clone; the preset task contract the run carried (requiredChecks: task-acceptance) is not
// rebuilt here, so the assessment does not list it among required checks; the harness home and
// process isolation of the runner are not recreated.
//
//   node replay-launch-1-controller.mjs --session <launch-1 session dir> --mode replay|weakened --out <json> [--mirror <bare clone>]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { swarmContract } from "../../../../scripts/comparison/arms.mjs";
import { tasks } from "../../../../scripts/comparison/tasks.mjs";
import { swarmGateOverrides } from "../../../../scripts/comparison/workspace.mjs";
import { createSystemClock } from "../../../../src/cli-runtime-inputs.ts";
import { taskGoalGate } from "../../../../src/cli-task-goal.ts";
import { declareGoalContract } from "../../../../src/evidence/goal-contract.ts";
import { recordRunAssessment } from "../../../../src/evidence/run-assessment.ts";
import { openEvidenceSession } from "../../../../src/evidence/session.ts";
import { runGatesEngine } from "../../../../src/gates/engine.ts";
import { createFileSetRegistry } from "../../../../src/gates/file-set.ts";
import { measureTestFile } from "../../../../src/gates/measures.ts";
import { base, changeAgainst, cloneBase, ensureMirror, git, readLedger, replayRange } from "./replay-edits.mjs";

const { values } = parseArgs({
  options: { session: { type: "string" }, mode: { type: "string" }, out: { type: "string" }, mirror: { type: "string" } },
});
if (values.session === undefined || values.out === undefined || !["replay", "weakened"].includes(values.mode ?? ""))
  throw new Error("usage: replay-launch-1-controller.mjs --session <dir> --mode replay|weakened --out <json> [--mirror <bare clone>]");
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const mode = values.mode;
const task = tasks.find((one) => one.id === "sinon-bugfix-stub-accessor-calls-v2");
const declaredFiles = ["src/sinon/default-behaviors.js", "src/sinon/stub.js", "test/src/stub-test.js"];
const firstCandidate = "sha256:c5a77e64b861d6b9b0b4ffaae6ff1769ce68d2027884305ef250106d0589297b";
const repairedCandidate = "sha256:737535fda55ec58764e1d77f323416d4d6f740e7c4c8db57d1f0a52b6fbcce95";

const root = mkdtempSync(join(tmpdir(), `sinon-controller-${mode}-`));
const workspace = cloneBase(ensureMirror(values.mirror), join(root, "workspace"));
mkdirSync(join(workspace, task.visible.path, ".."), { recursive: true });
writeFileSync(join(workspace, task.visible.path), task.visible.source, { flag: "wx" });
git(workspace, "add", "--force", task.visible.path);
git(workspace, "-c", "user.name=replay", "-c", "user.email=replay@localhost", "commit", "--quiet", "-m", "visible check");
const baseRef = git(workspace, "rev-parse", "HEAD").trim();
execFileSync("npm", ["ci", "--ignore-scripts"], {
  cwd: workspace,
  env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false", npm_config_update_notifier: "false", PUPPETEER_SKIP_DOWNLOAD: "true" },
  stdio: "ignore",
});

const ledger = readLedger(values.session);
const applied = { first: replayRange(workspace, ledger, 0, 272), repair: [] };
const first = changeAgainst(workspace, baseRef);
if (first.digest !== firstCandidate) throw new Error(`the first candidate reconstructs as ${first.digest}, not ${firstCandidate}`);

/** Delete one declared test the repair added, by name, from the file as the repair left it. */
function deleteOneAddedTest(path, baseText) {
  const text = readFileSync(path, "utf8");
  const atBase = new Set(Object.keys(measureTestFile(baseText).perTest));
  const added = Object.keys(measureTestFile(text).perTest).filter((name) => !atBase.has(name));
  const name = added[0];
  if (name === undefined) throw new Error("the repaired file adds no test to delete");
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes(`it("${name}"`));
  if (start < 0) throw new Error(`the test ${JSON.stringify(name)} was not found by its declaration`);
  const indent = /^\s*/.exec(lines[start])[0];
  const end = lines.findIndex((line, index) => index > start && line === `${indent}});`);
  if (end < 0) throw new Error(`the end of ${JSON.stringify(name)} was not found`);
  lines.splice(start, end - start + 1);
  writeFileSync(path, lines.join("\n"));
  return name;
}

const clock = createSystemClock();
const evidence = await openEvidenceSession({ root: join(root, "sessions"), sessionId: `replay-launch-1-${mode}`, clock });
const contract = await declareGoalContract(evidence, swarmContract(task));
const overrides = swarmGateOverrides(task);
const fileSet = createFileSetRegistry(evidence);
await fileSet.declare(declaredFiles, "model");
const events = [];
const log = (event) => {
  events.push(event);
  if (["gate", "attempt", "ratchet", "escalated", "plan"].includes(event.type))
    console.error(`${new Date().toISOString().slice(11, 19)} ${JSON.stringify(event).slice(0, 220)}`);
};
let deleted = null;
const baseTestText = git(workspace, "show", `${base}:test/src/stub-test.js`);
const started = Date.now();
const gates = await runGatesEngine({
  workspaceRoot: workspace,
  baseRef,
  evidence,
  fileSet,
  clock,
  emit: log,
  cap: 3,
  gateOptions: {
    commandOverrides: overrides,
    lockfile: "package-lock.json",
    acceptanceGate: taskGoalGate({
      contract,
      workspace,
      baseCommit: baseRef,
      evidence,
      clock,
      signal: new AbortController().signal,
      isolation: null,
      install: true,
      lockfile: "package-lock.json",
      commandOverrides: overrides,
      challengePolicy: "off",
    }),
  },
  resolve: async (request) => {
    if (request.attempt !== 1) throw new Error(`replay: the recorded launch's attempt ${request.attempt} is not replayed here`);
    applied.repair = replayRange(workspace, ledger, 290, 427);
    if (mode === "weakened") deleted = deleteOneAddedTest(join(workspace, "test/src/stub-test.js"), baseTestText);
  },
});
const verdict = await recordRunAssessment(evidence, gates, "max-steps", "restricted", false);
const final = changeAgainst(workspace, baseRef);
const cycles = [gates.outcome.firstCycle, ...gates.outcome.attempts.map((attempt) => attempt.cycle)].map((cycle) => ({
  attempt: cycle.attempt,
  statuses: cycle.statuses,
}));
const result = {
  mode,
  startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  workspace,
  baseRef,
  sealedGates: gates.gates.map((gate) => `${gate.id}:${gate.severity}`),
  firstCandidateDigest: first.digest,
  calls: { firstLoop: applied.first.length, repairAttempt1: applied.repair.length },
  deletedTest: deleted,
  cycles,
  ratchet: gates.outcome.attempts.map((attempt) => ({ attempt: attempt.attempt, accepted: attempt.decision.accepted, detail: attempt.decision.detail, respecification: attempt.respecification.map((one) => one.reason) })),
  baseComparison: { accepted: gates.outcome.baseComparison.decision.accepted, detail: gates.outcome.baseComparison.decision.detail },
  settled: gates.outcome.settled,
  finalCycleAttempt: gates.outcome.finalCycle.attempt,
  finalTreeDigest: final.digest,
  finalTreeIs: final.digest === repairedCandidate ? "the repaired candidate (repair attempt 1)" : final.digest === firstCandidate ? "the first candidate (the repair was rolled back)" : "neither recorded candidate",
  continuation: gates.outcome.continuation,
  regressionTests: gates.outcome.regressionTests,
  bonds: gates.bonds.map((bond) => ({ gateId: bond.gateId, verdict: bond.verdict })),
  assessment: { lifecycle: "max-steps", acceptable: verdict.acceptable, reasons: verdict.reasons },
  escalation: gates.outcome.escalation === null ? null : { gateId: gates.outcome.escalation.gateId, reason: gates.outcome.escalation.reason },
  expected: mode === "replay"
    ? { ratchetAccepted: true, settled: "green", finalTreeDigest: repairedCandidate, acceptable: true }
    : { ratchetAccepted: false, settled: "escalated", finalTreeDigest: firstCandidate, acceptable: false },
};
result.asExpected =
  result.ratchet[0]?.accepted === result.expected.ratchetAccepted &&
  result.settled === result.expected.settled &&
  result.finalTreeDigest === result.expected.finalTreeDigest &&
  result.assessment.acceptable === result.expected.acceptable;
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ mode, ratchet: result.ratchet.map((one) => one.accepted), settled: result.settled, finalTreeIs: result.finalTreeIs, acceptable: verdict.acceptable, asExpected: result.asExpected, durationMs: result.durationMs }));
