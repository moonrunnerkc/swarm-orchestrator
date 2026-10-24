// Per study and arm, the audit's counts as a Markdown table, from audit-study.mjs's outputs.
// usage: node summarize.mjs results/audit-fresh.json [more.json ...]
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const yes = (value) => value === true;
for (const file of process.argv.slice(2)) {
  const { launches } = JSON.parse(readFileSync(file, "utf8"));
  const arms = [...new Set(launches.map((one) => one.arm))];
  console.log(`\n### ${basename(file, ".json")}\n`);
  console.log(
    "| Arm | Launches | Frozen hidden pass | Requested behaviour | Kept behaviour | Requested tests sensitive | No new static finding | No new test failure | Strictly complete | Product accepted | False accepts | False refusals | Wall (s) | Tokens |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const arm of arms) {
    const mine = launches.filter((one) => one.arm === arm);
    const count = (test) => mine.filter(test).length;
    const kept = mine.filter((one) => one.preservedBehaviour?.pass !== null && one.preservedBehaviour !== undefined);
    const wall = mine.reduce((sum, one) => sum + (one.cost?.wallMs ?? 0), 0) / 1000;
    const tokens = mine.reduce((sum, one) => sum + (one.cost?.tokens ?? 0), 0);
    console.log(
      `| ${arm} | ${mine.length} | ${count((one) => one.frozenHidden === "pass")} | ${count((one) => yes(one.requestedBehaviour?.pass))} | ${kept.length === 0 ? "not measured" : `${kept.filter((one) => one.preservedBehaviour.pass === true).length} / ${kept.length}`} | ${count((one) => (one.requestedTests?.reading ?? "").startsWith("sensitive"))} (${count((one) => one.requestedTests?.reading === "not requested")} not requested) | ${count((one) => one.statics !== undefined && Object.values(one.statics).every((s) => (s.added ?? ["x"]).length === 0))} | ${count((one) => one.tests !== undefined && one.tests.newFailures.length === 0)} | ${count((one) => yes(one.strictComplete))} | ${mine[0]?.productAcceptable === null ? "n/a" : count((one) => yes(one.productAcceptable))} | ${count((one) => one.verdictAccuracy === "false accept")} | ${count((one) => one.verdictAccuracy === "false refusal")} | ${wall.toFixed(0)} | ${(tokens / 1e6).toFixed(2)}M |`,
    );
  }
}
