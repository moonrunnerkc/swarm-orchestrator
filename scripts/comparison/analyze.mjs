/**
 * The comparison's tables from its records, exact counts with their denominators. Nothing here
 * combines dimensions into a score; each is reported on its own.
 *
 *   node scripts/comparison/analyze.mjs --runs <directory> [--out <markdown file>]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A launch record's file name: a cell's record or one of its failed attempts; not a halt or recovery. */
export const isLaunchRecord = (name) =>
  /^[a-z][a-z0-9-]*\.(swarm|opencode)\.(json|(infrastructure|halted)-\d+\.json)$/.test(name);

/** One record per task and arm: the completed one where it exists, else the last failed attempt. */
export function latestAttempts(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = `${record.task}\u0000${record.arm}`;
    const current = byKey.get(key);
    if (
      current === undefined ||
      (current.infrastructureFailure !== null && record.infrastructureFailure === null)
    )
      byKey.set(key, record);
  }
  return [...byKey.values()];
}

export function summarize(allRecords) {
  const records = latestAttempts(allRecords);
  const byArm = { swarm: [], opencode: [] };
  for (const record of records) byArm[record.arm]?.push(record);
  const tasks = [...new Set(records.map((record) => record.task))].sort();
  const armRows = {};
  for (const [arm, rows] of Object.entries(byArm)) {
    const started = rows.length;
    const infrastructure = rows.filter((row) => row.infrastructureFailure !== null);
    const correct = rows.filter((row) => row.hidden.verdict === "pass");
    const correctNoCorrection = correct.filter((row) => row.corrections === 0);
    const claimedWrong = rows.filter(
      (row) => row.invocations.at(-1)?.claimedSuccess === true && row.hidden.verdict !== "pass",
    );
    const unresolved = rows.filter((row) => !row.resolvedVisible);
    const tokensKnown = rows.filter(
      (row) => row.totals.tokens !== null && row.totals.tokensUnknownInvocations === 0,
    );
    const sum = (list, pick) => list.reduce((total, row) => total + pick(row), 0);
    armRows[arm] = {
      started,
      infrastructureFailures: infrastructure.length,
      correct: correct.length,
      correctWithoutCorrection: correctNoCorrection.length,
      correctionsTotal: sum(rows, (row) => row.corrections),
      correctionsByCount: [0, 1, 2].map((n) => rows.filter((row) => row.corrections === n).length),
      visibleUnresolved: unresolved.length,
      claimedSuccessButHiddenFailed: claimedWrong.length,
      agentWallMsAll: sum(rows, (row) => row.totals.agentWallMs),
      agentWallMsCorrect: sum(correct, (row) => row.totals.agentWallMs),
      preparationWallMsAll: sum(rows, (row) => row.preparation.wallMs),
      tokensAllKnown: sum(tokensKnown, (row) => row.totals.tokens),
      tokensKnownRuns: tokensKnown.length,
      tokensUnknownRuns: rows.length - tokensKnown.length,
      tokensCorrectKnown: sum(
        correct.filter((row) => tokensKnown.includes(row)),
        (row) => row.totals.tokens,
      ),
      correctWithKnownTokens: correct.filter((row) => tokensKnown.includes(row)).length,
    };
  }
  const paired = tasks.map((task) => {
    const pick = (arm) => byArm[arm].find((row) => row.task === task) ?? null;
    const s = pick("swarm");
    const o = pick("opencode");
    const cell = (row) =>
      row === null
        ? "not run"
        : row.infrastructureFailure
          ? "infrastructure"
          : `${row.hidden.verdict}${row.corrections > 0 ? ` (+${row.corrections} corr.)` : ""}${row.resolvedVisible ? "" : ", visible unresolved"}`;
    return { task, swarm: cell(s), opencode: cell(o), swarmRecord: s, opencodeRecord: o };
  });
  return { arms: armRows, paired, tasks: tasks.length };
}

const minutes = (ms) => `${(ms / 60_000).toFixed(1)} min`;

export function renderMarkdown(summary) {
  const lines = [];
  lines.push("| measure | swarm | opencode |", "| --- | --- | --- |");
  const row = (label, pick) =>
    lines.push(
      `| ${label} | ${pick(summary.arms.swarm ?? {})} | ${pick(summary.arms.opencode ?? {})} |`,
    );
  row("tasks started", (a) => `${a.started ?? 0}`);
  row("infrastructure failures (not the arm's doing)", (a) => `${a.infrastructureFailures ?? 0}`);
  row(
    "correct completion (hidden oracle passed) / started",
    (a) => `${a.correct ?? 0} / ${a.started ?? 0}`,
  );
  row(
    "correct without any scripted correction / started",
    (a) => `${a.correctWithoutCorrection ?? 0} / ${a.started ?? 0}`,
  );
  row(
    "scripted corrections used, total (runs with 0 / 1 / 2)",
    (a) => `${a.correctionsTotal ?? 0} (${(a.correctionsByCount ?? [0, 0, 0]).join(" / ")})`,
  );
  row("visible checks still failing after the protocol", (a) => `${a.visibleUnresolved ?? 0}`);
  row(
    "reported success while the hidden oracle failed",
    (a) => `${a.claimedSuccessButHiddenFailed ?? 0}`,
  );
  row("agent wall time, all runs", (a) => minutes(a.agentWallMsAll ?? 0));
  row("agent wall time, correct runs only", (a) => minutes(a.agentWallMsCorrect ?? 0));
  row("preparation wall time, all runs (install, outside the agent)", (a) =>
    minutes(a.preparationWallMsAll ?? 0),
  );
  row(
    "tokens, all runs with known usage",
    (a) =>
      `${(a.tokensAllKnown ?? 0).toLocaleString("en-US")} over ${a.tokensKnownRuns ?? 0} runs (${a.tokensUnknownRuns ?? 0} unknown)`,
  );
  row("tokens per correct task (known usage)", (a) =>
    a.correctWithKnownTokens
      ? `${Math.round(a.tokensCorrectKnown / a.correctWithKnownTokens).toLocaleString("en-US")} over ${a.correctWithKnownTokens}`
      : "no correct run with known usage",
  );
  lines.push("", "| task | swarm | opencode |", "| --- | --- | --- |");
  for (const pair of summary.paired)
    lines.push(`| ${pair.task} | ${pair.swarm} | ${pair.opencode} |`);
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("analyze.mjs")) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const word = process.argv[index];
    if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
  }
  const directory = args.get("runs");
  const records = readdirSync(directory)
    .filter(isLaunchRecord)
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")));
  const summary = summarize(records);
  const markdown = renderMarkdown(summary);
  if (args.has("out")) writeFileSync(args.get("out"), `${markdown}\n`);
  console.log(markdown);
}
