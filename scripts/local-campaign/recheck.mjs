import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { digestOfJson } from "../../src/evidence/canonical-json.ts";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { exportSession, load, record, save, session, sourceIdentity } from "./evidence.mjs";
import { runArm } from "./execute.mjs";
import { selectBaseline, summarizeCampaign } from "./report.mjs";

const evidence = await session("development-recheck");
const cases = await load("cases.json");
const budget = (await load("protocol.json")).budget;
const paths = [
  ...execFileSync("git", ["ls-files", "src"], {
    encoding: "utf8",
    env: harnessChildEnvironment().variables,
    timeout: 10000,
  })
    .trim()
    .split("\n"),
  ...(await readdir("scripts/local-campaign"))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => join("scripts/local-campaign", name)),
];
const sources = await sourceIdentity(paths);
const practiceSchedule = cases
  .filter((one) => one.phase === "practice")
  .flatMap((one) =>
    ["direct-once", "direct-feedback"].map((arm) => ({
      caseId: one.id,
      arm,
      runId: `recheck-${one.id}-${arm}`,
    })),
  );
const launch = async (entry) => {
  if (digestOfJson(await sourceIdentity(paths)) !== digestOfJson(sources))
    throw new Error("development recheck sources changed after freeze");
  console.log(entry.runId);
  const observed = await runArm(
    cases.find((one) => one.id === entry.caseId),
    entry.arm,
    entry.runId,
    budget,
  );
  await save(`recheck/runs/${entry.runId}.json`, observed);
  if (observed.cleanup !== "confirmed") throw new Error(`reconcile cleanup for ${entry.runId}`);
  return observed;
};
try {
  if (evidence.records().length)
    throw new Error("development recheck already launched; preserve its outcomes");
  await record(evidence, "development-recheck-frozen", {
    sources,
    budget,
    practiceSchedule,
    casesDigest: digestOfJson(cases),
    reason: "Ollama reasoning_effort transport repair; all cases were exposed in the earlier pilot",
    confirmatory: false,
  });
  const practice = [];
  for (const entry of practiceSchedule) practice.push(await launch(entry));
  const selection = selectBaseline(practice);
  await save("recheck/baseline-selection.json", selection);
  const schedule = cases
    .filter((one) => one.phase === "evaluation")
    .flatMap((one) =>
      [selection.selected, "swarm"].map((arm) => ({
        caseId: one.id,
        arm,
        runId: `recheck-${one.id}-${arm}`,
      })),
    );
  const protocol = {
    sources,
    budget,
    schedule,
    practiceSchedule,
    selection,
    confirmatory: false,
    exposure: "previously exposed development cases; not a new held-out population",
  };
  await record(evidence, "development-comparison-frozen", protocol);
  await save("recheck/protocol.json", protocol);
  const rows = [];
  for (const entry of schedule) rows.push(await launch(entry));
  const summary = summarizeCampaign(rows, schedule);
  await record(evidence, "development-recheck-finished", summary);
  await save("recheck/summary.json", summary);
} finally {
  await exportSession(evidence);
}
