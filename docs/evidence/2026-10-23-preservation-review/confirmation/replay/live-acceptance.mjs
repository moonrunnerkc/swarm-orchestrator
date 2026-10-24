// The acceptance gate's reading of every recorded final verification of the given studies, under
// this source: whether a reading the change left unmeasured is read as the change's.
//
// usage: npx tsx live-acceptance.mjs <study directory>...
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readAcceptance } from "../../../../../src/cli-task-goal.ts";
for (const stage of process.argv.slice(2)) {
  const sessions = join(stage, "runs/sessions");
  for (const name of readdirSync(sessions).sort()) {
    const dir = join(sessions, name);
    if (!existsSync(join(dir, "ledger.jsonl"))) continue;
    let contract = null;
    let last = null;
    for (const line of readFileSync(join(dir, "ledger.jsonl"), "utf8").split("\n")) {
      if (!line) continue;
      const record = JSON.parse(line);
      const payload = JSON.parse(readFileSync(join(dir, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"));
      if (record.type === "goal-contract" && contract === null) contract = payload.contract;
      if (record.type === "independent-verification" && payload.checks?.length && payload.goalAcceptance) last = payload;
    }
    if (contract === null || last === null) continue;
    const reading = readAcceptance(contract, last);
    console.log(stage.split("/").at(-1), name.padEnd(55), "unmeasured", last.unmeasured, "byChange", reading.unmeasuredByChange, "unavailable", reading.unavailable);
  }
}
