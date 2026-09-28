#!/usr/bin/env node
/**
 * Comparison B: complete coding workflows, under the amendment registered in
 * docs/verifier-first/comparison-protocol.md before any B run.
 *
 *   node scripts/comparison-b.mjs derive  [--out <dir>]
 *   node scripts/comparison-b.mjs verdict [--out <dir>] [--version 1.0.4]
 *   node scripts/comparison-b.mjs repair  [--out <dir>] [--version 1.0.4]
 *   node scripts/comparison-b.mjs report  [--out <dir>] [--page <file>]
 *
 * derive reads the shared prefix the reach-pressure experiment's generation 3 recorded and
 * writes one row per task: its fork (the first step whose visible oracle accepted the task), the
 * patch B0 stops on and that patch's recorded held-back outcome. verdict runs the released
 * verifier's regression-only verdict on each fork patch, which decides whether B1 stops there or
 * repairs. report tallies the paired held-back outcomes. A row that needs a repair is reported as
 * such until a repair has run; no outcome is imputed for it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const prefixEvidence = "docs/evidence/2026-09-17/reach-pressure-experiment";
const prefixBulk = join(homedir(), ".cache/swarm-pr-tasks/reach-pressure/g3");
const corpusRoot = join(homedir(), ".cache/swarm-pr-tasks");
// The prefix's own harness, built from the commit its rows name, so the repair runs the same
// agent, judge and scorer the prefix ran. Only the verdict fed back is the released verifier's.
const prefixHarness = join(homedir(), ".cache/swarm-comparison-b/harness-dce76cc7e");
const bRoot = join(homedir(), ".cache/swarm-comparison-b/work");
const parameters = {
  model: "local:malekoo/Qwen3.8-27B-MLX-8bit",
  endpoint: "http://127.0.0.1:8000/v1",
  agent: { maxWallMinutes: 12, maxTokens: 1_000_000, thinking: false },
  repairInvocations: 2,
};

const [command, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = rest.indexOf(name);
  return at === -1 ? fallback : rest[at + 1];
};
const out = resolve(flag("--out", "docs/evidence/2026-09-28/comparison-b"));
const rowsPath = join(out, "rows.json");

const readJsonl = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
const sha256 = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
const writeRows = (rows) => writeFileSync(rowsPath, `${JSON.stringify(rows, null, 2)}\n`);

function derive() {
  const manifest = JSON.parse(readFileSync(join(prefixEvidence, "manifest.json"), "utf8"));
  const results = new Map();
  for (const row of readJsonl(join(prefixEvidence, "results.jsonl")))
    if (row.trajectory !== undefined) results.set(row.taskId, row);
  const hidden = new Map();
  for (const score of readJsonl(join(prefixEvidence, "hidden-scores.jsonl")))
    hidden.set(`${score.taskId} ${score.patchDigest}`, score.hidden);
  const rows = manifest.tasks.map((task) => {
    const result = results.get(task.id);
    const steps = result?.trajectory?.steps ?? [];
    const fork = steps.find((step) => step.observation?.verdict?.task === "accepted") ?? null;
    const finalDigest = result?.trajectory?.control?.patchDigest ?? steps.at(-1)?.patch?.digest;
    const b0Digest = fork?.patch?.digest ?? finalDigest ?? null;
    return {
      taskId: task.id,
      repository: task.repository,
      baseCommit: task.baseCommit,
      prefixStatus: result?.trajectory?.status ?? "absent",
      fork:
        fork === null
          ? null
          : {
              ordinal: fork.ordinal,
              phase: fork.phase,
              prefixRegression: fork.observation.verdict.regression,
              patchDigest: fork.patch.digest,
            },
      b0: {
        patchDigest: b0Digest,
        hidden: b0Digest === null ? "unjudgeable" : (hidden.get(`${task.id} ${b0Digest}`) ?? null),
      },
    };
  });
  mkdirSync(out, { recursive: true });
  writeRows(rows);
  const forks = rows.filter((row) => row.fork !== null).length;
  console.log(`${rows.length} task(s), ${forks} with a fork; rows in ${rowsPath}`);
}

function verdict() {
  const version = flag("--version", "1.0.4");
  const rows = JSON.parse(readFileSync(rowsPath, "utf8"));
  const reports = join(homedir(), ".cache/swarm-comparison-b/reports", version);
  mkdirSync(reports, { recursive: true });
  for (const row of rows) {
    if (row.fork === null || row.b1Verdict?.version === version) continue;
    const patch = join(prefixBulk, "patches", `${row.fork.patchDigest.slice(7)}.patch`);
    const checkout = join(corpusRoot, "work", row.repository.replace("/", "__"));
    if (!existsSync(patch) || !existsSync(checkout)) {
      row.b1Verdict = { version, outcome: "blocked", reason: "patch or checkout absent" };
      writeRows(rows);
      continue;
    }
    row.b1Verdict = regressionVerdict({ version, patch, checkout, row, reports, label: "fork" });
    // The registered rule: only a regression the patch caused is something a repair can act on.
    row.b1 =
      row.b1Verdict.outcome !== "executed"
        ? { decision: "blocked" }
        : row.b1Verdict.regression === "fail"
          ? { decision: "repair-needed" }
          : { decision: "stop", patchDigest: row.fork.patchDigest, hidden: row.b0.hidden };
    writeRows(rows);
    console.log(
      `${row.taskId}: ${row.b1Verdict.outcome} regression=${row.b1Verdict.regression ?? ""} -> ${row.b1.decision}`,
    );
  }
}

/** The released verifier's regression-only verdict on one patch, with its report kept by digest. */
function regressionVerdict({ version, patch, checkout, row, reports, label }) {
  // The suite's own time zone, as the prefix's judge set it: dayjs runs its suite under
  // declared zones, and a verdict taken under this machine's zone is about a different run.
  let zone = null;
  try {
    const manifest = JSON.parse(
      execFileSync("git", ["show", `${row.baseCommit}:package.json`], {
        cwd: checkout,
        encoding: "utf8",
      }),
    );
    zone = /\bTZ=([\w/+-]+)/.exec(manifest.scripts?.test ?? "")?.[1] ?? null;
  } catch {
    zone = null;
  }
  const startedAt = Date.now();
  const ran = spawnSync(
    "npx",
    [
      "--yes",
      `swarm-verify@${version}`,
      "ci",
      "--patch",
      patch,
      "--workspace",
      checkout,
      "--base",
      row.baseCommit,
      "--install",
      "--json",
    ],
    {
      cwd: homedir(),
      encoding: "utf8",
      timeout: 30 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", ...(zone === null ? {} : { TZ: zone }) },
    },
  );
  const stem = join(reports, `${row.taskId.replace(/[/#]/g, "_")}.${label}`);
  writeFileSync(`${stem}.report.json`, ran.stdout ?? "");
  writeFileSync(`${stem}.stderr.txt`, ran.stderr ?? "");
  let report = null;
  try {
    report = JSON.parse((ran.stdout ?? "").trim().split("\n").at(-1) ?? "");
  } catch {
    report = null;
  }
  return report === null
    ? {
        version,
        outcome: "blocked",
        reason: `the verifier exited ${ran.status} without a report`,
        wallMs: Date.now() - startedAt,
      }
    : {
        version,
        outcome: "executed",
        zone,
        regression: report.regression,
        refusal: report.refusal ?? null,
        failed: (report.checks ?? [])
          .filter((check) => check.status === "failed" && check.inheritedFromBase !== true)
          .map((check) => check.id),
        details: (report.checks ?? [])
          .filter((check) => check.status === "failed" && check.inheritedFromBase !== true)
          .map((check) => `${check.id}: ${check.detail ?? ""}`.slice(0, 400)),
        inherited: (report.checks ?? [])
          .filter((check) => check.inheritedFromBase === true)
          .map((check) => check.id),
        reportDigest: sha256(`${stem}.report.json`),
        wallMs: Date.now() - startedAt,
      };
}

/** Feedback built from the verdict's fields alone, attributed as the verifier's output. */
function feedbackOf(verdict) {
  return [
    `Tool output from an independent verifier (swarm-verify ${verdict.version}, regression-only): it ran the repository's own checks with the change in this workspace applied and at the base commit without it.`,
    "These checks fail with the change applied and pass without it:",
    ...verdict.details.map((line) => `  ${line}`),
    "The change is already in this workspace. Revise it so that the repository's own checks pass again, and keep what the task asks for.",
  ].join("\n");
}

async function repair() {
  const version = flag("--version", "1.0.4");
  const rows = JSON.parse(readFileSync(rowsPath, "utf8"));
  const from = (path) => import(join(prefixHarness, "dist", path));
  const lib = {
    ...(await from("evidence/canonical-json.js")),
    ...(await from("eval/pr-task-judge.js")),
    ...(await from("eval/pr-task-paths.js")),
    ...(await from("eval/reach-pressure.js")),
    ...(await from("eval/sealed-workspace.js")),
  };
  const manifest = JSON.parse(readFileSync(join(prefixEvidence, "manifest.json"), "utf8"));
  const viable = JSON.parse(readFileSync("campaign/pr-tasks/viable.json", "utf8")).tasks;
  const reports = join(homedir(), ".cache/swarm-comparison-b/reports", version);
  for (const directory of [join(bRoot, "patches"), join(bRoot, "oracles"), reports])
    mkdirSync(directory, { recursive: true });
  for (const row of rows) {
    if (row.b1?.decision !== "repair-needed") continue;
    const task = manifest.tasks.find((one) => one.id === row.taskId);
    const source = viable.find(
      (one) => one.repository === task.repository && one.pull === task.pull,
    );
    if (source === undefined || lib.digestOfBytes(source.taskText) !== task.taskTextDigest)
      throw new Error(`${task.id}: the task text no longer matches the frozen digest`);
    const checkout = lib.taskCheckout(corpusRoot, task);
    const storedTestFile = join(bRoot, "oracles", `${lib.taskSlug(task)}.test-file`);
    const oracleBytes = execFileSync("git", ["show", `${task.mergeCommit}:${task.testFile}`], {
      cwd: checkout,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (lib.digestOfBytes(oracleBytes) !== task.oracleFileDigest)
      throw new Error(`${task.id}: the oracle file no longer matches the frozen digest`);
    writeFileSync(storedTestFile, oracleBytes);
    const patchPathOf = (digest) => join(bRoot, "patches", `${digest.slice(7)}.patch`);
    cpSync(
      join(prefixBulk, "patches", `${row.fork.patchDigest.slice(7)}.patch`),
      patchPathOf(row.fork.patchDigest),
    );
    // The fork state: the base, the sealed oracle kept out, and the fork patch applied.
    const workspace = join(bRoot, "runs", lib.taskSlug(task));
    await lib.prepareSealedWorkspace({
      checkout,
      workspace,
      baseCommit: task.baseCommit,
      mergeCommit: task.mergeCommit,
      testFile: task.testFile,
      untrackedFiles: {
        "swarm.toml": `[providers]\nlocal_endpoint = "${parameters.endpoint}"\nlocal_thinking = ${parameters.agent.thinking}\n`,
      },
    });
    const applied = await lib.runCommand(
      "git",
      ["apply", "--index", patchPathOf(row.fork.patchDigest)],
      { cwd: workspace },
    );
    if (applied.code !== 0) throw new Error(`${task.id}: the fork patch did not apply`);
    const installed = await lib.runCommand(
      "npm",
      ["ci", "--no-audit", "--no-fund", "--loglevel=error"],
      {
        cwd: workspace,
        timeoutMs: 15 * 60_000,
      },
    );
    if (installed.code !== 0) throw new Error(`${task.id}: npm ci failed in the workspace`);
    const judgedTask = { ...task, sealedCases: task.visibleCases };
    const judgeFor = (digest) =>
      lib.halfJudgeFor({
        task: judgedTask,
        checkout,
        patchPath: patchPathOf(digest),
        storedTestFile,
        cliPath: join(prefixHarness, "dist/cli.js"),
        isolation: null,
      });
    const steps = [];
    let verdict = row.b1Verdict;
    let current = row.fork.patchDigest;
    let visibleTask = "accepted";
    for (let invocation = 1; invocation <= parameters.repairInvocations; invocation += 1) {
      const health = await lib.endpointGenerates(
        parameters.endpoint,
        parameters.model.replace(/^local:/, ""),
      );
      if (!health.answered)
        throw new Error(`the model endpoint does not generate: ${health.detail}`);
      const prompt = lib.repairPrompt(source.taskText, feedbackOf(verdict));
      const started = Date.now();
      const agent = await lib.runCommand(
        process.execPath,
        [
          join(prefixHarness, "dist/cli.js"),
          "--model",
          parameters.model,
          "--local-endpoint",
          parameters.endpoint,
          "--no-tui",
          "--json",
          "--workspace",
          workspace,
          "--base",
          task.baseCommit,
          "--max-tokens",
          String(parameters.agent.maxTokens),
          "--max-wall-minutes",
          String(parameters.agent.maxWallMinutes),
          prompt,
        ],
        { cwd: workspace, timeoutMs: (parameters.agent.maxWallMinutes + 4) * 60_000 },
      );
      // Asked again after the invocation, as the prefix's harness did: a server that died
      // mid-run returns nothing, which would otherwise record as the model changing nothing.
      const after = await lib.endpointGenerates(
        parameters.endpoint,
        parameters.model.replace(/^local:/, ""),
      );
      if (!after.answered)
        throw new Error(`the model endpoint stopped generating during ${task.id}: ${after.detail}`);
      await lib.runCommand("git", ["add", "-A"], { cwd: workspace });
      const diff = await lib.runCommand("git", ["diff", "--cached", task.baseCommit], {
        cwd: workspace,
      });
      const digest = lib.digestOfBytes(diff.stdout);
      if (!existsSync(patchPathOf(digest))) writeFileSync(patchPathOf(digest), diff.stdout);
      current = digest;
      const visible = await (await judgeFor(digest))(task.visibleCases);
      visibleTask = visible.task;
      verdict = regressionVerdict({
        version,
        patch: patchPathOf(digest),
        checkout,
        row,
        reports,
        label: `repair-${invocation}`,
      });
      steps.push({
        invocation,
        exitCode: agent.code,
        timedOut: agent.timedOut,
        wallMs: Date.now() - started,
        promptDigest: lib.digestOfBytes(prompt),
        patchDigest: digest,
        visibleTask,
        regression: verdict.regression ?? null,
      });
      console.log(
        `${task.id}: repair ${invocation} visible=${visibleTask} regression=${verdict.regression}`,
      );
      if (verdict.regression === "pass" && visibleTask === "accepted") break;
      if (verdict.outcome !== "executed" || verdict.regression !== "fail") break;
    }
    // The held-back half, scored as the prefix's own script scored it at its harness commit:
    // the oracle alone (the repository's checks were measured when the visible half judged this
    // patch), then accepted is pass, rejected is fail, anything else unjudgeable.
    const settled = await lib.settleHeldBack(await judgeFor(current), judgedTask, visibleTask, {
      oracleOnly: true,
    });
    const hidden =
      settled.heldBackVerdict === "accepted"
        ? "pass"
        : settled.heldBackVerdict === "rejected"
          ? "fail"
          : "unjudgeable";
    row.b1 = {
      decision: "repaired",
      steps,
      patchDigest: current,
      satisfied: verdict.regression === "pass" && visibleTask === "accepted",
      hidden,
      heldBackVerdict: settled.heldBackVerdict,
      orderDependent: settled.orderDependent,
      basis:
        hidden === "unjudgeable"
          ? (lib.whyNothingWasJudged(settled.heldBack) ??
            `the held-back oracle read ${settled.heldBackVerdict}`)
          : "the held-back half's own verdict on this patch",
    };
    writeRows(rows);
    console.log(`${task.id}: B1 ended on ${current.slice(7, 19)}, held-back ${hidden}`);
  }
}

function report() {
  const rows = JSON.parse(readFileSync(rowsPath, "utf8"));
  const page = flag("--page", "docs/results/comparison-b.md");
  const forks = rows.filter((row) => row.fork !== null);
  const repairs = forks.filter((row) => row.b1?.decision === "repaired");
  const outcomeOf = (arm, row) =>
    arm === "B0"
      ? row.b0.hidden
      : row.fork === null
        ? row.b0.hidden
        : row.b1?.decision === "stop" || row.b1?.decision === "repaired"
          ? row.b1.hidden
          : (row.b1?.decision ?? "not-run");
  const tally = (arm) => {
    const counts = {};
    for (const row of rows) {
      const outcome = outcomeOf(arm, row) ?? "unscored";
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
    return counts;
  };
  const pairs = { help: 0, harm: 0, concordant: 0, open: 0 };
  for (const row of rows) {
    const a = outcomeOf("B0", row);
    const b = outcomeOf("B1", row);
    if (!["pass", "fail"].includes(a) || !["pass", "fail"].includes(b)) pairs.open += 1;
    else if (a === b) pairs.concordant += 1;
    else if (a === "fail") pairs.help += 1;
    else pairs.harm += 1;
  }
  const format = (counts) =>
    Object.entries(counts)
      .sort()
      .map(([key, count]) => `${key} ${count}`)
      .join(", ");
  const text = `# Comparison B: complete coding workflows

Derived from \`${rowsPath.replace(`${process.cwd()}/`, "")}\` (digest ${sha256(rowsPath)}) under
the Comparison B amendment of \`docs/verifier-first/comparison-protocol.md\`, registered before
any B run. Shared prefix: the reach-pressure experiment's generation 3 over
\`mined-pr-viable-79\` with Qwen3.8-27B (MLX, 8-bit, greedy, thinking off).

${rows.length} tasks; ${forks.length} reached a fork (the visible oracle accepted a step). Every
task without a fork ends on the prefix's final patch in every arm, so its pair is concordant by
construction.

| Arm | Held-back outcomes over ${rows.length} tasks |
| --- | --- |
| B0: the repository's own visible checks, stop at the fork | ${format(tally("B0"))} |
| B1: plus the released verifier's regression-only verdict fed back | ${format(tally("B1"))} |
| B2: plus requirement challenges | not applicable: no task in the cohort carries a requirement contract |

Paired B0 against B1: help ${pairs.help} (B0 fails held-back, B1 passes), harm ${pairs.harm}
(B0 passes, B1 fails), concordant ${pairs.concordant}, not yet paired ${pairs.open}. The frozen
rule calls no difference below ten discordant pairs; the most this design can produce is
${forks.length}, one per fork.

## B1's repairs

${repairs.length} fork patch(es) failed the verifier's regression-only verdict and were fed back.
${repairs
  .map(
    (row) =>
      `- ${row.taskId}: ${row.b1.steps.length} invocation(s); ${row.b1.satisfied ? "regression passed with the visible oracle still accepting" : "regression still failed after the last invocation"}; the final patch ${row.b1.patchDigest === row.fork.patchDigest ? "is the fork patch unchanged" : "differs from the fork patch"}. Feedback: ${row.b1Verdict.details.join("; ")}.`,
  )
  .join("\n")}

## Fork rows

| Task | Prefix regression at the fork | B1 verdict (${forks[0]?.b1Verdict?.version ?? "not run"}) | B1 decision | B0 held-back | B1 held-back |
| --- | --- | --- | --- | --- | --- |
${forks
  .map(
    (row) =>
      `| ${row.taskId} | ${row.fork.prefixRegression} | ${row.b1Verdict?.outcome === "executed" ? `regression ${row.b1Verdict.regression}${row.b1Verdict.failed.length > 0 ? `, failed: ${row.b1Verdict.failed.join(", ")}` : ""}${row.b1Verdict.inherited.length > 0 ? `, inherited: ${row.b1Verdict.inherited.join(", ")}` : ""}` : (row.b1Verdict?.reason ?? "not run")} | ${row.b1?.decision ?? "not run"} | ${row.b0.hidden} | ${outcomeOf("B1", row)} |`,
  )
  .join("\n")}
`;
  writeFileSync(page, text);
  console.log(`comparison B written to ${page}: help ${pairs.help}, harm ${pairs.harm}`);
}

if (command === "derive") derive();
else if (command === "verdict") verdict();
else if (command === "repair") await repair();
else if (command === "report") report();
else {
  console.error("usage: comparison-b.mjs derive|verdict|repair|report [--out <dir>]");
  process.exit(2);
}
