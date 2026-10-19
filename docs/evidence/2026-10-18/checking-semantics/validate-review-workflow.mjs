#!/usr/bin/env node
/**
 * The coverage-review step of planning, validated with no model on two existing development
 * fixtures of different structure: mime (a path parser, where the task states a text equivalence)
 * and node-tar (a binary header and pax parser, where the rule is numeric and no text equivalence
 * applies).
 *
 * For each, a scripted planner declares example checks and finishes without a coverage review, as
 * live planners finished without a relation. The product's own `planChecks` must then ask for the
 * review in its bounded round; the scripted review gives a relation for mime and says why none
 * applies for tar. Admission runs through the real base verifier on a real checkout of the task's
 * base, prepared as a run prepares it. The sealed planned checks are then judged by the same
 * verifier on the base, the retained faulty candidate and the upstream fix.
 *
 * The scripted declarations were written by the developers of this work, who know both tasks, the
 * faulty candidates and the evaluators: this validates the mechanism (the round is asked for, the
 * relation is enumerated by the harness through the named check's program, nothing is forced on
 * the numeric task), never that a model would write these reviews.
 *
 *   node validate-review-workflow.mjs --out <file>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  resolveFull,
  swarmConfigurationText,
  workRoot,
} from "../../../../scripts/comparison/workspace.mjs";
import { tasks, wrongPatches } from "../../../../scripts/pilot/tasks-2026-10-17.mjs";
import { planChecks } from "../../../../src/cli-plan-checks.ts";
import { admitPlannedChecks } from "../../../../src/cli-planned-checks.ts";
import { createSystemClock, createSystemRandom } from "../../../../src/cli-runtime-inputs.ts";
import { baseVerifier } from "../../../../src/cli-task-goal.ts";
import { parseSwarmToml } from "../../../../src/config/swarm-toml.ts";
import { freezeGoalContract } from "../../../../src/evidence/goal-contract.ts";
import { createRecordingModelClient } from "../../../../src/evidence/model-call-recording.ts";
import { openEvidenceSession } from "../../../../src/evidence/session.ts";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "../../../../src/providers/fixture-provider.ts";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (values.out === undefined) throw new Error("usage: validate-review-workflow.mjs --out <file>");
const clock = createSystemClock();
const log = commandLog(join(comparisonRoot, "blobs"));
mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, "review-workflow-"));
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=validation", "-c", "user.email=validation@localhost", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

const declare = (callId, input) => ({ callId, toolName: "declare_planned_check", input });
const review = (callId, input) => ({ callId, toolName: "declare_coverage_review", input });

/** What each fixture's scripted planner declares: its checks first, its review in the round. */
const fixtures = {
  "mime-bugfix-gettype-line-terminators": {
    checks: [
      declare("examples", {
        id: "gettype-examples",
        purpose: "change",
        requirementId: "terminators-ordinary",
        requirement: "a line terminator in a name is an ordinary character",
        quote: "Make getType treat every line terminator like any other character",
        program: "import mime from './dist/src/index.js';\nexport default (name) => mime.getType(name);\n",
        cases: [
          { input: "photo.png", expected: "image/png", changed: false },
          { input: "LINE\nFEED.png", expected: "image/png", changed: true },
          { input: "dir/LINE SEP.png", expected: "image/png", changed: true },
          { input: "noext", expected: null, changed: false },
        ],
        why: "the task's own example and its list of terminators, with an ordinary name and a name without an extension the task keeps",
      }),
    ],
    reviews: [
      review("terminators", {
        id: "terminator-like-space",
        requirementId: "terminators-ordinary",
        change: "a line terminator anywhere in a name is treated like any other character",
        keeps: "a space or tab in a name, directory parts and the extension after the last dot",
        wrongImplementation:
          "delete line terminators or treat them as path separators, which the examples at one position still pass",
        distinguishedBy: ["terminator-like-space"],
        relation: {
          purpose: "change",
          programFrom: "gettype-examples",
          seeds: ["NAME.png", "dir/NAME.png"],
          reference: "U+0020",
          variants: ["U+000A", "U+000D", "U+2028", "U+2029"],
        },
        untested:
          "types whose registered extensions contain a space or a line terminator: under the default types a terminator and a space give one answer, which does not hold where both are registered",
      }),
    ],
  },
  "tar-bugfix-negative-size": {
    checks: [
      declare("pax-size", {
        id: "pax-size",
        purpose: "change",
        requirementId: "pax-size",
        requirement: "a pax size record is kept only when it is zero or greater",
        quote: "In Pax.parse, a 'size' record is kept only when its numeric value is zero or greater",
        program: "import { Pax } from './dist/esm/pax.js';\nexport default (record) => Pax.parse(record).size ?? null;\n",
        cases: [
          { input: "13 size=1000\n", expected: 1000, changed: false },
          { input: "10 size=0\n", expected: 0, changed: false },
          { input: "14 size=-1000\n", expected: null, changed: true },
        ],
        why: "the task's own values: 'size=-1000' leaves size undefined, 'size=1000' gives 1000 and 'size=0' gives 0",
      }),
      declare("pax-other", {
        id: "pax-other-fields",
        purpose: "preserve",
        requirementId: "other-fields",
        requirement: "every other pax field keeps its parsing, negative values included",
        quote: "Every other field (uid, gid, mode, the times and so on) keeps its current parsing, negative values included",
        program: "import { Pax } from './dist/esm/pax.js';\nexport default (record) => Pax.parse(record).uid ?? null;\n",
        cases: [
          { input: "10 uid=-1\n", expected: -1 },
          { input: "12 uid=1000\n", expected: 1000 },
        ],
        why: "the task keeps negative values of other fields",
      }),
    ],
    reviews: [
      review("size", {
        id: "size-sign",
        requirementId: "pax-size",
        change: "a negative pax size record leaves size undefined",
        keeps: "zero and positive sizes",
        wrongImplementation: "drop every record whose value starts with a minus sign, which the size cases alone pass",
        distinguishedBy: ["pax-size", "pax-other-fields"],
        noRelation: "the rule is a numeric comparison; no text in a record behaves like other text",
        untested: "the Header class's own size field and the global extended header",
      }),
      review("other", {
        id: "other-fields-kept",
        requirementId: "other-fields",
        change: "none",
        keeps: "uid and the other fields, negative values included",
        wrongImplementation: "refuse every negative value",
        distinguishedBy: ["pax-other-fields"],
        noRelation: "a numeric rule with no text substitution",
        untested: "gid, mode and the times",
      }),
    ],
  },
};

const rows = [];
for (const task of tasks) {
  const fixture = fixtures[task.id];
  const { base: original, upstream } = await resolveFull(log, task);
  const workspace = join(scratch, task.id);
  await cloneAtBase(log, task, original, workspace);
  const base = await commitVisibleCheck(log, task, workspace);
  // The faulty candidate and the upstream fix as commits beside the base, each judged by the
  // same verifier on a fresh checkout, as admission judges the base.
  const commitWith = async (branch, patch) => {
    git(workspace, "checkout", "-q", "-b", branch, base);
    if (!(await applyPatch(log, workspace, patch))) throw new Error(`${task.id}: the ${branch} patch does not apply`);
    git(workspace, "add", "-A");
    git(workspace, "commit", "-qm", branch);
    const commit = git(workspace, "rev-parse", "HEAD");
    git(workspace, "checkout", "-q", base);
    return commit;
  };
  const upstreamPatch = execFileSync("git", ["diff", "--binary", original, upstream, "--", "src"], {
    cwd: join(comparisonRoot, "mirrors", `${task.repository.replace("/", "__")}.git`),
    encoding: "utf8",
  });
  const trees = {
    base,
    faulty: await commitWith("faulty", wrongPatches[`${task.id}-r1`]),
    upstream: await commitWith("upstream", upstreamPatch),
  };
  const prepared = await prepare(log, task, workspace);
  if (!prepared.ok) throw new Error(`${task.id}: preparation failed: ${prepared.detail}`);
  const overrides = parseSwarmToml(swarmConfigurationText("http://127.0.0.1:1/v1", task), "swarm.toml").gates;
  const verifierAt = (commit, evidence) => (contract) =>
    baseVerifier({
      contract,
      workspace,
      baseCommit: commit,
      evidence,
      clock,
      signal: new AbortController().signal,
      isolation: null,
      install: true,
      lockfile: "package-lock.json",
      commandOverrides: overrides,
    })(contract);
  const model = createFixtureModelClient({
    modelId: "fixture:review-workflow",
    turns: [
      respondWithToolCalls("declaring the checks", fixture.checks),
      respondWithText("Checks declared."),
      respondWithToolCalls("the coverage review", fixture.reviews),
      respondWithText("Reviewed."),
    ],
  });
  const notes = [];
  const sessions = join(scratch, `${task.id}-sessions`);
  const outcome = await planChecks({
    task: task.taskText,
    workspace,
    home: join(scratch, "home"),
    sessionRoot: sessions,
    runId: task.id,
    createModel: (planning) => createRecordingModelClient(model, planning),
    clock,
    random: createSystemRandom(),
    maxSteps: 8,
    maxTokens: 200_000,
    maxWallMs: 30 * 60_000,
    signal: new AbortController().signal,
    note: (line) => notes.push(line),
    admit: (chain, contract, supplied) =>
      admitPlannedChecks({ contract, base: supplied, evidence: chain, verifyAtBase: verifierAt(base, chain) }),
  });
  if (outcome.kind !== "sealed") throw new Error(`${task.id}: planning ended ${outcome.kind}`);
  const planned = outcome.contract.checks.map((one) => one.id);
  const judged = {};
  for (const [tree, commit] of Object.entries(trees)) {
    const evidence = await openEvidenceSession({ root: sessions, sessionId: `${task.id}-${tree}`, clock });
    const contract = freezeGoalContract({
      ...outcome.contract,
      requirements: [{ id: "judged", description: "every sealed planned check", checks: planned }],
    }).contract;
    const result = await verifierAt(commit, evidence)(contract);
    judged[tree] = Object.fromEntries(
      (result.checkResults ?? []).map((one) => [one.id, one.status]),
    );
  }
  rows.push({
    task: task.id,
    trees,
    reviewRound: outcome.admission?.review.round ?? null,
    reviews: outcome.admission?.review.reviews ?? [],
    unreviewed: outcome.admission?.review.unreviewed ?? [],
    admitted: outcome.admission?.admitted ?? [],
    unestablished: outcome.admission?.unestablished ?? [],
    dropped: outcome.admission?.dropped ?? [],
    sealedChecks: planned,
    relations: outcome.contract.checks.filter((one) => one.command.startsWith("planned relation")).map((one) => one.id),
    judged,
    notes,
  });
}

const result = {
  schema: "swarm-review-workflow-validation.v1",
  kind: "developer-scripted planner on two exposed development fixtures, no model; validates the mechanism, not a model's reviews",
  product: git(new URL("../../../../", import.meta.url).pathname, "rev-parse", "HEAD"),
  dirtySource: git(new URL("../../../../", import.meta.url).pathname, "status", "--porcelain", "--", "src").length > 0,
  node: process.version,
  rows,
  scratch,
};
writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
for (const row of rows)
  console.log(
    JSON.stringify({
      task: row.task,
      round: row.reviewRound,
      relations: row.relations,
      admitted: row.admitted,
      unestablished: row.unestablished.map((one) => one.check),
      dropped: row.dropped.map((one) => one.check),
      judged: row.judged,
    }),
  );
