/**
 * Copy a stage's records and the evidence they cite into the pilot's evidence directory, whole
 * enough that the analysis can be derived from the directory alone: every record, halt and
 * recovery as written; each launch's final patch; every blob a launch record cites, compressed
 * under its digest; for every Swarm invocation, the session's ledger, bundle manifest and the
 * payloads of its gate runs; the base commit's package.json scripts for each task; and for
 * reading, each invocation's result line and output tail, or OpenCode's events, plus the stderr
 * tail. Nothing is fabricated: a blob the cache no longer holds is listed as missing in the
 * index, and the analyzer reports the record that cites it as incomplete.
 *
 *   node scripts/pilot/publish.mjs --manifest <file> --out-dir <directory> --label <stage-a|stage-b|dev>
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { digestOf } from "../comparison/arms.mjs";
import { comparisonRoot, mirrorOf } from "../comparison/workspace.mjs";
import { citedDigests, isLaunchRecord } from "./analyze.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const manifestBytes = readFileSync(args.get("manifest"), "utf8");
const manifest = JSON.parse(manifestBytes);
const digest = digestOf(manifestBytes);
const runs = join(comparisonRoot, "runs", digest.slice(7, 23));
const blobs = join(comparisonRoot, "blobs");
const sessionsRoot = join(homedir(), ".swarm", "sessions");
const label = args.get("label") ?? "stage";
const outDir = join(args.get("out-dir"), label);
for (const sub of ["records", "patches", "output", "blobs", "sessions"])
  mkdirSync(join(outDir, sub), { recursive: true });
writeFileSync(join(outDir, "manifest.json"), manifestBytes);

const blob = (cited) => {
  const path = join(blobs, cited.slice(7));
  return existsSync(path) ? readFileSync(path) : null;
};
const tail = (text, lines) => (text ?? "").trim().split("\n").slice(-lines).join("\n");
const packed = new Map();
function pack(cited) {
  if (packed.has(cited)) return packed.get(cited);
  const bytes = blob(cited);
  if (bytes === null) {
    packed.set(cited, "missing");
    return "missing";
  }
  if (digestOf(bytes) !== cited) {
    packed.set(cited, "corrupt-in-cache");
    return "corrupt-in-cache";
  }
  writeFileSync(join(outDir, "blobs", `${cited.slice(7)}.gz`), gzipSync(bytes, { level: 9 }));
  packed.set(cited, "packed");
  return "packed";
}

/** Swarm's result line in an invocation's stdout, for the session it names. */
function runIdOf(stdout) {
  for (const line of stdout.split("\n").reverse()) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.schema === "swarm.result.v1") return parsed.runId ?? null;
    } catch {}
  }
  return null;
}

/** The session's ledger, bundle manifest and gate-run payloads, compressed, with digests. */
function packSession(runId) {
  const session = join(sessionsRoot, runId);
  const out = join(outDir, "sessions", runId);
  const files = {};
  if (!existsSync(session)) return { runId, present: false, files };
  mkdirSync(out, { recursive: true });
  const ledgerPath = join(session, "ledger.jsonl");
  if (existsSync(ledgerPath)) {
    const ledger = readFileSync(ledgerPath);
    writeFileSync(join(out, "ledger.jsonl.gz"), gzipSync(ledger, { level: 9 }));
    files["ledger.jsonl"] = { digest: digestOf(ledger), bytes: ledger.length };
    // The gate-run payloads, by the ledger's own records, read from the session's blob store.
    const gateRuns = [];
    for (const line of ledger.toString("utf8").trim().split("\n")) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== "gate-run") continue;
      const payloadPath = join(
        session,
        "blobs",
        `${entry.payloadDigest.replace(/^sha256:/, "")}.json`,
      );
      if (!existsSync(payloadPath)) continue;
      const payload = readFileSync(payloadPath);
      if (digestOf(payload) !== entry.payloadDigest) continue;
      gateRuns.push({
        sequence: entry.sequence,
        timestamp: entry.timestamp,
        ...JSON.parse(payload.toString("utf8")),
      });
    }
    const serialized = Buffer.from(JSON.stringify(gateRuns));
    writeFileSync(join(out, "gate-runs.json.gz"), gzipSync(serialized, { level: 9 }));
    files["gate-runs.json"] = {
      digest: digestOf(serialized),
      bytes: serialized.length,
      count: gateRuns.length,
    };
  }
  const bundleManifest = join(session, "bundle", "manifest.json");
  if (existsSync(bundleManifest)) {
    const bytes = readFileSync(bundleManifest);
    writeFileSync(join(out, "bundle-manifest.json.gz"), gzipSync(bytes, { level: 9 }));
    files["bundle-manifest.json"] = { digest: digestOf(bytes), bytes: bytes.length };
  }
  return { runId, present: true, files };
}

/** The base commit's package.json scripts, from the sealed mirror, so a gate can be read against its body. */
function projectScripts() {
  const scripts = {};
  for (const task of manifest.tasks) {
    const shown = spawnSync("git", ["show", `${task.baseCommit}:package.json`], {
      cwd: mirrorOf(task.repository),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (shown.status !== 0) continue;
    try {
      scripts[task.id] = JSON.parse(shown.stdout).scripts ?? {};
    } catch {}
  }
  return scripts;
}

let copied = 0;
const index = [];
const sessions = [];
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
  const packedBlobs = {};
  for (const cited of citedDigests(record)) packedBlobs[cited] = pack(cited);
  record.invocations.forEach((invocation, position) => {
    const stdout = blob(invocation.stdoutDigest)?.toString("utf8") ?? "";
    const stderr = blob(invocation.stderrDigest)?.toString("utf8") ?? "";
    const kept = [];
    if (record.arm === "swarm") {
      const runId = runIdOf(stdout);
      if (runId !== null) sessions.push(packSession(runId));
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
    blobs: packedBlobs,
  });
}
const scripts = projectScripts();
writeFileSync(join(outDir, "project-scripts.json"), `${JSON.stringify(scripts, null, 2)}\n`);
const states = [...packed.values()];
writeFileSync(
  join(outDir, existsSync(join(outDir, "index.json")) ? "index-v2.json" : "index.json"),
  `${JSON.stringify(
    {
      schema: "swarm-real-task-pilot.evidence-index.v2",
      manifestDigest: digest,
      runs,
      publishedAt: new Date().toISOString(),
      blobs: {
        packed: states.filter((one) => one === "packed").length,
        missing: states.filter((one) => one === "missing").length,
        corrupt: states.filter((one) => one === "corrupt-in-cache").length,
        format:
          "blobs/<sha256 hex>.gz, gzip of the exact bytes; the analyzer verifies each against its name",
      },
      sessions,
      launches: index,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `${copied} file(s) copied from ${runs} to ${outDir}; ${states.filter((one) => one === "packed").length} blob(s) packed, ${states.filter((one) => one !== "packed").length} not in the cache; ${sessions.filter((one) => one.present).length} session(s) packaged`,
);
