/**
 * The executable proof of the comparison's stop controls, and its verification. Producing it runs
 * the fault-injection suite against the real runner and derives every verdict in the manifest
 * from what ran: the per-case results of the suite, the measured detection and termination
 * times, the fingerprints of the files that executed, and (when given) the live smoke's records
 * and the retained before-and-after evidence. Nothing in the manifest is a flag set by hand.
 *
 *   node scripts/prove-comparison-stop-controls.mjs --out docs/evidence/comparison-stop-controls
 *       [--smoke-manifest <file>] [--before <file>] [--broken <file>] [--ci <url>]...
 *   node scripts/prove-comparison-stop-controls.mjs --verify docs/evidence/comparison-stop-controls
 *
 * `--verify` recomputes the fingerprints of the execution files in this tree and the digests of
 * every retained evidence file, and fails when any differs: the command to run before trusting
 * the proof against a later checkout.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { isLaunchRecord } from "./comparison/analyze.mjs";
import { digestOf } from "./comparison/arms.mjs";
import { detectionDeadlineMs, terminationDeadlineMs } from "./comparison/control.mjs";
import { harnessDigest } from "./comparison/harness-identity.mjs";
import { comparisonRoot } from "./comparison/workspace.mjs";

const args = new Map();
const repeated = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (!word.startsWith("--")) continue;
  const value = process.argv[index + 1] ?? "true";
  const key = word.slice(2);
  if (key === "ci") repeated.set(key, [...(repeated.get(key) ?? []), value]);
  else args.set(key, value);
}

const root = join(import.meta.dirname, "..");
const rel = (path) => relative(root, path);

/** The files whose bytes decide what the controls do, and the files that exercise them. */
const executionFiles = [
  "scripts/comparison/run.mjs",
  "scripts/comparison/control.mjs",
  "scripts/comparison/endpoint.mjs",
  "scripts/comparison/schema.mjs",
  "scripts/comparison/arms.mjs",
  "scripts/comparison/checks.mjs",
  "scripts/comparison/workspace.mjs",
  "scripts/comparison/harness-identity.mjs",
  "scripts/comparison/order.mjs",
  "scripts/campaign/exec.mjs",
];
const proofFiles = [
  "scripts/comparison/run.test.mjs",
  "scripts/comparison/control.test.mjs",
  "scripts/comparison/endpoint.test.mjs",
  "scripts/comparison/fixtures/arm.mjs",
  "scripts/comparison/fixtures/endpoint-server.mjs",
  "scripts/comparison/fixtures/smoke-manifest.mjs",
  "scripts/prove-comparison-stop-controls.mjs",
  "docs/evidence/2026-10-11/comparison/protocol.md",
];
const fileDigest = (path) => digestOf(readFileSync(join(root, path)));
const fingerprints = () =>
  Object.fromEntries([...executionFiles, ...proofFiles].map((path) => [path, fileDigest(path)]));

const git = (...argv) => spawnSync("git", argv, { cwd: root, encoding: "utf8" }).stdout.trim();

function retain(outDir, sourcePath, label) {
  const bytes = readFileSync(sourcePath);
  const digest = digestOf(bytes);
  const name = `${digest.slice(7, 23)}${sourcePath.endsWith(".json") ? ".json" : ".txt"}`;
  mkdirSync(join(outDir, "blobs"), { recursive: true });
  writeFileSync(join(outDir, "blobs", name), bytes);
  return { label, file: `blobs/${name}`, digest, bytes: bytes.length };
}

function runSuite(outDir) {
  const report = join(tmpdir(), `stop-controls-vitest-${process.pid}.json`);
  const measurements = join(tmpdir(), `stop-controls-measurements-${process.pid}.json`);
  const started = new Date().toISOString();
  const ran = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "scripts/comparison/run.test.mjs",
      "scripts/comparison/control.test.mjs",
      "scripts/comparison/endpoint.test.mjs",
      "--reporter=json",
      `--outputFile=${report}`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, COMPARISON_PROOF_OUT: measurements, CI: "1" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const parsed = existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : null;
  const cases = (parsed?.testResults ?? []).flatMap((file) =>
    file.assertionResults.map((one) => ({
      file: rel(file.name),
      name: one.fullName,
      status: one.status,
      durationMs: Math.round(one.duration ?? 0),
    })),
  );
  // The reporter's own JSON is the retained output; the console carries little under it.
  const log = existsSync(report)
    ? report
    : join(tmpdir(), `stop-controls-vitest-${process.pid}.log`);
  if (!existsSync(report)) writeFileSync(log, `${ran.stdout}\n${ran.stderr}`);
  return {
    command:
      "npx vitest run scripts/comparison/run.test.mjs scripts/comparison/control.test.mjs scripts/comparison/endpoint.test.mjs",
    startedAt: started,
    endedAt: new Date().toISOString(),
    exitCode: ran.status,
    cases,
    passed: cases.filter((one) => one.status === "passed").length,
    failed: cases.filter((one) => one.status === "failed").length,
    skipped: cases.filter((one) => !["passed", "failed"].includes(one.status)).length,
    measurements: existsSync(measurements) ? JSON.parse(readFileSync(measurements, "utf8")) : [],
    log: retain(outDir, log, "fault-injection suite reporter output (vitest JSON)"),
  };
}

/** The smoke's records, summarised; the full records stay in the cache and are cited by digest. */
function smokeSummary(manifestPath) {
  const bytes = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(bytes);
  const digest = digestOf(bytes);
  const runs = join(comparisonRoot, "runs", digest.slice(7, 23));
  const names = existsSync(runs) ? readdirSync(runs).sort() : [];
  const launches = names.filter(isLaunchRecord).map((name) => {
    const text = readFileSync(join(runs, name), "utf8");
    const record = JSON.parse(text);
    return {
      file: name,
      digest: digestOf(text),
      task: record.task,
      arm: record.arm,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      preparation: record.preparation,
      invocations: record.invocations.map((one) => ({
        kind: one.kind,
        exitCode: one.exitCode,
        signal: one.signal,
        wallMs: one.wallMs,
        tokens: one.tokens,
        claimedSuccess: one.claimedSuccess,
        visiblePassed: one.visible.passed,
      })),
      corrections: record.corrections,
      resolvedVisible: record.resolvedVisible,
      hidden: record.hidden.verdict,
      hiddenBasis: record.hidden.basis,
      finalPatchBytes: record.finalPatchBytes,
      oracleExposure: record.oracleExposure,
      infrastructureFailure: record.infrastructureFailure,
      halt: record.halt ?? null,
    };
  });
  const halts = names.filter((name) => /^halt-\d+\.json$/.test(name));
  return {
    manifest: {
      digest,
      pins: manifest.pins,
      budgets: manifest.budgets,
      launches: manifest.launches.length,
    },
    runs,
    launches,
    halts,
    workLeft: existsSync(join(comparisonRoot, "work"))
      ? readdirSync(join(comparisonRoot, "work")).filter((name) => name.startsWith("smoke-"))
      : [],
  };
}

function produce(outDir) {
  mkdirSync(outDir, { recursive: true });
  const suite = runSuite(outDir);
  const retained = [];
  if (args.has("before"))
    retained.push(
      retain(
        outDir,
        args.get("before"),
        "regression test against the runner before the change (fails: launches continued)",
      ),
    );
  if (args.has("broken"))
    retained.push(
      retain(
        outDir,
        args.get("broken"),
        "fault suite against a scratch copy whose halt path continues (fails)",
      ),
    );
  const smoke = args.has("smoke-manifest") ? smokeSummary(args.get("smoke-manifest")) : null;
  if (smoke) retained.push(retain(outDir, args.get("smoke-manifest"), "smoke manifest"));
  const timing = suite.measurements.map((one) => ({
    ...one,
    withinDetectionDeadline:
      one.detectionMs === undefined || one.detectionMs <= detectionDeadlineMs,
    withinTerminationDeadline:
      one.cleanup.outcome === "terminated" && one.cleanup.wallMs <= terminationDeadlineMs,
  }));
  const checks = {
    suiteGreen: suite.exitCode === 0 && suite.failed === 0 && suite.passed > 0,
    everyMeasurementWithinDeadlines:
      timing.length === 3 &&
      timing.every((one) => one.withinDetectionDeadline && one.withinTerminationDeadline),
    beforeEvidenceRetained: args.has("before") && args.has("broken"),
    smokeComplete:
      smoke !== null &&
      smoke.launches.length === smoke.manifest.launches &&
      smoke.launches.every(
        (one) => one.infrastructureFailure === null && one.invocations.length > 0,
      ) &&
      smoke.halts.length === 0 &&
      smoke.workLeft.length === 0,
  };
  const manifest = {
    schema: "swarm.comparison-stop-controls.proof.v1",
    producedAt: new Date().toISOString(),
    platform: { os: process.platform, arch: process.arch, node: process.version },
    source: {
      commit: git("rev-parse", "HEAD"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      // Tracked modifications only: the evidence this writes is itself untracked until committed.
      dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
      harnessDigest: harnessDigest(),
      fingerprints: fingerprints(),
    },
    limits: { detectionDeadlineMs, terminationDeadlineMs, pollIntervalMs: 2000 },
    suite,
    timing,
    retained,
    smoke,
    ci: repeated.get("ci") ?? [],
    checks,
    result: Object.values(checks).every(Boolean) ? "pass" : "fail",
  };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${manifest.result}: suite ${suite.passed} passed / ${suite.failed} failed / ${suite.skipped} skipped; ${timing.length} timing measurement(s); smoke ${smoke ? `${smoke.launches.length} of ${smoke.manifest.launches} launches, ${smoke.halts.length} halt(s)` : "not included"}; ${rel(join(outDir, "manifest.json"))}`,
  );
  return manifest.result === "pass" ? 0 : 1;
}

function verify(outDir) {
  const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const problems = [];
  const current = fingerprints();
  for (const [path, digest] of Object.entries(manifest.source.fingerprints))
    if (current[path] !== digest)
      problems.push(`${path} is ${current[path] ?? "absent"}, the proof ran against ${digest}`);
  if (manifest.source.harnessDigest !== harnessDigest())
    problems.push(
      `the harness digest is ${harnessDigest()}, the proof ran against ${manifest.source.harnessDigest}`,
    );
  for (const item of [...manifest.retained, manifest.suite.log]) {
    const path = join(outDir, item.file);
    if (!existsSync(path)) problems.push(`${item.file} is missing`);
    else if (digestOf(readFileSync(path)) !== item.digest)
      problems.push(`${item.file} does not match its digest`);
  }
  if (manifest.result !== "pass") problems.push(`the recorded result is ${manifest.result}`);
  const checks = manifest.checks;
  for (const [name, held] of Object.entries(checks))
    if (!held) problems.push(`check ${name} did not hold when the proof was produced`);
  if (problems.length === 0) {
    console.log(
      `verified: the proof at ${rel(outDir)} applies to this tree (commit ${manifest.source.commit.slice(0, 9)}, ${Object.keys(current).length} fingerprints unchanged, evidence intact)`,
    );
    return 0;
  }
  console.error(`the proof at ${rel(outDir)} does not apply:\n  ${problems.join("\n  ")}`);
  return 1;
}

process.exit(
  args.has("verify")
    ? verify(args.get("verify"))
    : produce(args.get("out") ?? "docs/evidence/comparison-stop-controls"),
);
