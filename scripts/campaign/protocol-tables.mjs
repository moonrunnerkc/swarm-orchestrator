#!/usr/bin/env node
/**
 * The goal, coverage and attack-family tables the registered protocol quotes, generated from the
 * goal packages themselves so the document cannot drift from the material it freezes.
 *
 *   node scripts/campaign/protocol-tables.mjs --goals <id list file>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGoalPackage } from "./goal-package.mjs";
import { sealedRoot } from "./truth.mjs";
import { campaignRoot } from "./workspace.mjs";

export function tables(loaded) {
  const final = loaded.filter((one) => one.goal.set === "final");
  const development = loaded.filter((one) => one.goal.set === "development");
  const row = ({ goal }) =>
    `| \`${goal.id}\` | ${goal.repository} | \`${goal.upstreamBase.slice(0, 12)}\` | ${goal.workType} | ${goal.surfaces.join(", ") || "none"} | ${goal.conditions.length} | \`${goal.hidden.digest.slice(7, 19)}\` |`;
  const header =
    "| Goal | Repository | Base | Work type | Surfaces | Conditions | Hidden oracle |\n| --- | --- | --- | --- | --- | --- | --- |";
  const count = (predicate) => final.filter(predicate).length;
  const coverage = [
    ...["bugfix", "feature", "refactor", "upgrade"].map(
      (type) => `${type} ${count((one) => one.goal.workType === type)}`,
    ),
    ...["cli", "http", "browser", "multi-package"].map(
      (surface) => `${surface} ${count((one) => one.goal.surfaces.includes(surface))}`,
    ),
    `Node ${count((one) => one.goal.ecosystem === "node")}`,
    `Python ${count((one) => one.goal.ecosystem === "python")}`,
    `repositories ${new Set(final.map((one) => one.goal.repository)).size}`,
  ].join(", ");
  const families = Array.from({ length: 13 }, (_, at) => at + 1).map((family) => {
    const holders = final.filter((one) =>
      one.goal.conditions.some((condition) => condition.attackFamilies.includes(family)),
    );
    const conditions = final.flatMap((one) =>
      one.goal.conditions.filter((condition) => condition.attackFamilies.includes(family)),
    ).length;
    return `| ${family} | ${conditions} | ${holders.length} |`;
  });
  const truths = {};
  for (const { goal } of final)
    for (const condition of goal.conditions)
      truths[condition.truth] = (truths[condition.truth] ?? 0) + 1;
  return {
    goals: `${header}\n${final.map(row).join("\n")}`,
    development: `${header}\n${development.map(row).join("\n")}`,
    coverage: `Counts over the final goals: ${coverage}. Conditions by truth: ${Object.entries(
      truths,
    )
      .map(([truth, n]) => `${truth} ${n}`)
      .join(", ")}.`,
    families: `| Family | Conditions | Goals |\n| --- | --- | --- |\n${families.join("\n")}`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = process.argv.indexOf("--goals");
  const ids = readFileSync(process.argv[at + 1], "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const loaded = ids.map((id) => loadGoalPackage(join(campaignRoot, "goals", id), { sealedRoot }));
  const out = tables(loaded);
  for (const [name, text] of Object.entries(out)) console.log(`<!-- ${name} -->\n${text}\n`);
}
