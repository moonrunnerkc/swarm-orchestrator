#!/usr/bin/env node
/**
 * Classifies why a run did not end green, from its bundle's ledger and nothing else. One
 * cause per run, decided by the first rule that fires, and every signal the rule read is
 * carried in the row so a reader can disagree with the rule from the same facts.
 *
 *   node scripts/terminal-causes.mjs <bundle directory> [...]
 *
 * The causes, in the order the rules fire:
 *
 *   environment  a blocking format, lint or typecheck gate failed on paths under a dependency
 *                directory the run never touched, so no change could have made it pass;
 *   planner      the file-set gate escalated: an edit before any declaration named its file,
 *                or outside the declared set;
 *   retry        one empty response ended the loop, or every attempt failed the same gate
 *                with the same detail;
 *   editor       edits the chokepoint refused, or the same call repeated back to back;
 *   model        everything else: the budget spent, the backend failing, or tests the model
 *                could not make pass.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { failureSignature } from "../src/gates/failure-signature.ts";

export const causes = Object.freeze(["environment", "planner", "retry", "editor", "model"]);

/** Directories a run is measured around and never writes: dependencies the harness installed. */
const dependencyDirectories = [".campaign/", "node_modules/", ".venv/", "vendor/"];

export function readBundle(directory) {
  const ledger = readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  return ledger.map((record) => {
    const blob = join(directory, "blobs", `${record.payloadDigest.replace("sha256:", "")}.json`);
    return { sequence: record.sequence, type: record.type, payload: existsSync(blob) ? JSON.parse(readFileSync(blob, "utf8")) : null };
  });
}

function pathsInDiff(records) {
  const diff = records.find((record) => record.type === "workspace-diff");
  const patch = diff?.payload?.patch ?? "";
  return [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((match) => match[1]);
}

/** The signals every rule reads, computed once per bundle. */
export function signalsOf(records) {
  const stopped = records.find((record) => record.type === "session-stopped");
  const escalation = records.find((record) => record.type === "escalation")?.payload ?? null;
  const gateRuns = records.filter((record) => record.type === "gate-run");
  const settled = [...records].reverse().find((record) => record.type === "tool-call" && record.payload?.decision !== "requested");
  const tools = records.filter((record) => record.type === "tool-call" && record.payload?.decision !== "requested");
  const firstEdit = tools.find((record) => record.payload.kind === "write" || ["edit", "write"].includes(record.payload.toolName));
  const firstDeclaration = records.find((record) => record.type === "file-set-declared");
  const editDenials = tools.filter((record) => ["edit", "write"].includes(record.payload.toolName) && record.payload.decision === "denied").length;

  let repeatedCalls = 0;
  for (let index = 1; index < tools.length; index += 1) {
    const previous = tools[index - 1].payload;
    const current = tools[index].payload;
    if (previous.toolName === current.toolName && JSON.stringify(previous.input) === JSON.stringify(current.input)) repeatedCalls += 1;
  }

  const escalatedRuns = escalation === null ? [] : gateRuns.filter((record) => record.payload.gateId === escalation.gateId);
  // Where the harness measured the base itself, that record decides, and the heuristics
  // below are for bundles from before it did.
  const recordedAtBase = (escalation?.failingAtBase ?? []).includes(escalation?.gateId);
  // The failure as the runner named it, with numbers dropped so a timing or a line count does
  // not make two identical failures read as progress. Two attempts that leave the same failing
  // tests failing changed nothing the gate could see.
  const signatures = new Set(escalatedRuns.map((record) => failureSignature(record.payload)));
  const lastEscalatedRun = escalatedRuns.at(-1)?.payload ?? null;
  const output = lastEscalatedRun === null ? "" : `${lastEscalatedRun.stdout}\n${lastEscalatedRun.stderr}`;
  const offendersInDependencies = output.split("\n").filter((line) => dependencyDirectories.some((directory) => line.includes(directory))).length;
  const offendersOutside = output.split("\n").filter((line) => /\.(go|py|ts|tsx|js|mjs|rs)\b/.test(line) && !dependencyDirectories.some((directory) => line.includes(directory))).length;
  const diffPaths = pathsInDiff(records);
  const diffTouchesDependencies = diffPaths.some((path) => dependencyDirectories.some((directory) => path.startsWith(directory)));

  return {
    stopReason: stopped?.payload?.stopReason ?? null,
    steps: stopped?.payload?.steps ?? null,
    escalatedGate: escalation?.gateId ?? null,
    attemptsUsed: escalation?.attemptsUsed ?? null,
    cap: escalation?.cap ?? null,
    sameFailureEveryAttempt: escalatedRuns.length > 1 && signatures.size === 1,
    recordedAtBase,
    editBeforeDeclaration: firstEdit !== undefined && (firstDeclaration === undefined || firstEdit.sequence < firstDeclaration.sequence),
    editDenials,
    repeatedCalls,
    offendersInDependencies,
    offendersOutside,
    diffTouchesDependencies,
    diffPaths: diffPaths.length,
    lastTool: settled?.payload?.toolName ?? null,
    green: escalation === null && stopped !== undefined && gateRuns.length > 0 && !gateRuns.some((record) => record.payload.blocking && record.payload.status === "failed" && record.payload.attempt === Math.max(...gateRuns.map((one) => one.payload.attempt))),
  };
}

/** The first rule that fires, with the sentence that says why. */
export function classify(signals) {
  if (signals.recordedAtBase) {
    return { cause: "environment", why: `the ${signals.escalatedGate} gate fails the same way at the base commit, measured by the harness` };
  }
  if (
    ["format", "lint", "typecheck"].some((gate) => signals.escalatedGate === gate || signals.escalatedGate?.startsWith(`${gate}:`)) &&
    signals.offendersInDependencies > 0 &&
    signals.offendersOutside === 0 &&
    !signals.diffTouchesDependencies
  ) {
    return { cause: "environment", why: `the ${signals.escalatedGate} gate failed on ${signals.offendersInDependencies} path(s) under a dependency directory the run never touched` };
  }
  if (signals.escalatedGate === "file-set") {
    return { cause: "planner", why: signals.editBeforeDeclaration ? "the first edit preceded any declaration naming its file" : "an edit fell outside the declared set" };
  }
  if (signals.stopReason === "empty-response") {
    return { cause: "retry", why: "one empty response ended the loop, and nothing sampled it again" };
  }
  if (signals.escalatedGate !== null && signals.attemptsUsed === signals.cap && signals.sameFailureEveryAttempt) {
    return { cause: "retry", why: `every attempt left the ${signals.escalatedGate} gate failing the same way` };
  }
  if (signals.editDenials >= 2 || signals.repeatedCalls >= 3) {
    return { cause: "editor", why: `${signals.editDenials} refused edit(s) and ${signals.repeatedCalls} repeated call(s)` };
  }
  return { cause: "model", why: `stopped as ${signals.stopReason ?? "unknown"}${signals.escalatedGate === null ? "" : ` and escalated at ${signals.escalatedGate}`}` };
}

export function renderTable(rows) {
  const lines = ["| run | cause | why | stop | escalated | attempts | edits refused | repeats |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    lines.push(`| ${row.run} | ${row.cause} | ${row.why} | ${row.signals.stopReason ?? ""} | ${row.signals.escalatedGate ?? ""} | ${row.signals.attemptsUsed ?? ""}${row.signals.cap === null ? "" : ` of ${row.signals.cap}`} | ${row.signals.editDenials} | ${row.signals.repeatedCalls} |`);
  }
  const tally = {};
  for (const row of rows) tally[row.cause] = (tally[row.cause] ?? 0) + 1;
  lines.push("", `Tally: ${causes.map((cause) => `${cause} ${tally[cause] ?? 0}`).join(", ")} over ${rows.length} non-green run(s).`);
  return lines.join("\n");
}

if (import.meta.filename === process.argv[1]) {
  const rows = [];
  for (const directory of process.argv.slice(2)) {
    if (!existsSync(join(directory, "ledger.jsonl"))) continue;
    const signals = signalsOf(readBundle(directory));
    if (signals.green) continue;
    const { cause, why } = classify(signals);
    rows.push({ run: `${basename(join(directory, "..", ".."))}/${basename(join(directory, ".."))}/${basename(directory)}`.replace(/^corpus\//, ""), cause, why, signals });
  }
  process.stdout.write(`${renderTable(rows)}\n`);
  process.stdout.write(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}
