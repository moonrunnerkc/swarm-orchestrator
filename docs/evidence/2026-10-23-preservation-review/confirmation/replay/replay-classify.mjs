// usage: npx tsx replay-classify.mjs <src/gates/repair-policy.ts of a build> <study directory>...
// Replays the repair classification over every recorded attempt's failing blocking gates, with
// the classifier given on the command line, so two builds can be compared on the same records.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const [classifierPath, ...stages] = process.argv.slice(2);
const { classifyRepair } = await import(classifierPath);
for (const stage of stages) {
  const sessions = join(stage, "runs/sessions");
  for (const name of readdirSync(sessions).sort()) {
    const dir = join(sessions, name);
    if (!existsSync(join(dir, "ledger.jsonl"))) continue;
    const byAttempt = new Map();
    for (const line of readFileSync(join(dir, "ledger.jsonl"), "utf8").split("\n")) {
      if (!line) continue;
      const record = JSON.parse(line);
      if (record.type !== "gate-run") continue;
      const p = JSON.parse(readFileSync(join(dir, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"));
      const run = { gateId: p.gateId, kind: p.parser === "inspection" ? "inspection" : "command", capability: p.capability, severity: p.severity, status: p.status, detail: p.detail ?? "", measures: p.measures ?? {}, parts: {}, observation: { exitCode: p.exitCode, stdout: p.stdout ?? "", stderr: p.stderr ?? "", durationMs: 0, unavailable: p.unavailable ?? null } };
      const list = byAttempt.get(p.attempt) ?? [];
      list.push(run);
      byAttempt.set(p.attempt, list);
    }
    const kinds = [...byAttempt.entries()].map(([attempt, runs]) => {
      const failing = runs.filter((r) => r.severity === "blocking" && r.status === "failed");
      return failing.length === 0 ? `${attempt}:green` : `${attempt}:${classifyRepair({ runs, blockingFailures: failing }).kind}`;
    });
    console.log(stage.split("/").at(-1), name.padEnd(55), kinds.join(" "));
  }
}
