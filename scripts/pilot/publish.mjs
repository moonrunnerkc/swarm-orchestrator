/**
 * Copy a stage's records and the evidence they cite into the pilot's evidence directory, small
 * enough to travel with the repository: every record, halt and recovery as written; each
 * launch's final patch; and for each invocation Swarm's result line and the non-JSON tail of
 * its output, or OpenCode's text, error and step events, plus the stderr tail. Full stdout
 * blobs stay in the comparison cache under their digests, which the records cite.
 *
 *   node scripts/pilot/publish.mjs --manifest <file> --out-dir <directory> --label <stage-a|stage-b>
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { digestOf } from "../comparison/arms.mjs";
import { comparisonRoot } from "../comparison/workspace.mjs";
import { isLaunchRecord } from "./analyze.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const manifestBytes = readFileSync(args.get("manifest"), "utf8");
const digest = digestOf(manifestBytes);
const runs = join(comparisonRoot, "runs", digest.slice(7, 23));
const blobs = join(comparisonRoot, "blobs");
const label = args.get("label") ?? "stage";
const outDir = join(args.get("out-dir"), label);
mkdirSync(join(outDir, "records"), { recursive: true });
mkdirSync(join(outDir, "patches"), { recursive: true });
mkdirSync(join(outDir, "output"), { recursive: true });
writeFileSync(join(outDir, "manifest.json"), manifestBytes);

const blob = (cited) => {
  const path = join(blobs, cited.slice(7));
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};
const tail = (text, lines) => (text ?? "").trim().split("\n").slice(-lines).join("\n");

let copied = 0;
const index = [];
for (const name of readdirSync(runs)
  .filter((one) => one.endsWith(".json"))
  .sort()) {
  copyFileSync(join(runs, name), join(outDir, "records", name));
  copied += 1;
  if (!isLaunchRecord(name)) continue;
  const record = JSON.parse(readFileSync(join(runs, name), "utf8"));
  const stem = name.replace(/\.json$/, "");
  const patch = blob(record.finalPatchDigest);
  if (patch !== null) writeFileSync(join(outDir, "patches", `${stem}.patch`), patch);
  record.invocations.forEach((invocation, position) => {
    const stdout = blob(invocation.stdoutDigest) ?? "";
    const stderr = blob(invocation.stderrDigest) ?? "";
    const kept = [];
    if (record.arm === "swarm") {
      for (const line of stdout.split("\n"))
        if (line.startsWith("{") && /"swarm\.result\.v1"/.test(line)) kept.push(line);
      kept.push(
        "",
        "--- non-JSON tail of stdout ---",
        tail(
          stdout
            .split("\n")
            .filter((line) => !line.startsWith("{"))
            .join("\n"),
          40,
        ),
      );
    } else {
      for (const line of stdout.split("\n")) {
        if (!line.startsWith("{")) continue;
        if (/"type":"(text|error|step_start|step_finish|tool_use|tool)"/.test(line))
          kept.push(line.length > 4000 ? `${line.slice(0, 4000)}...[truncated]` : line);
      }
    }
    kept.push("", "--- stderr tail ---", tail(stderr, 30));
    writeFileSync(
      join(outDir, "output", `${stem}.${invocation.kind}-${position}.txt`),
      `${kept.join("\n")}\n`,
    );
  });
  index.push({
    record: name,
    task: record.task,
    arm: record.arm,
    hidden: record.hidden.verdict,
    finalPatchDigest: record.finalPatchDigest,
    stdoutDigests: record.invocations.map((one) => one.stdoutDigest),
  });
}
writeFileSync(
  join(outDir, "index.json"),
  `${JSON.stringify({ schema: "swarm-real-task-pilot.evidence-index.v1", manifestDigest: digest, runs, publishedAt: new Date().toISOString(), launches: index }, null, 2)}\n`,
);
console.log(`${copied} file(s) copied from ${runs} to ${outDir}`);
