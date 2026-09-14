import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { openRunStore } from "../../src/durable/run-store.ts";
import { digestOfBytes, digestOfJson } from "../../src/evidence/canonical-json.ts";
import { indexCitedRecords } from "../../src/evidence/record-index.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { reconstructTranscript } from "../../src/evidence/transcript.ts";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { assembleGates } from "../../src/gates/default-gates.ts";
import { detectProject } from "../../src/gates/project-type.ts";
import { replayController } from "../../src/workers/controller-state.ts";
import { projectTrail } from "../../src/workers/trail.ts";
import { reportPilot } from "./pilot-report.mjs";

const repeats = 7;
const clock = { now: Date.now, sleep: async () => {} };
const git = (...argv) =>
  execFileSync("git", argv, { encoding: "utf8", env: harnessChildEnvironment().variables }).trim();
const measure = async (operation) => {
  const started = performance.now();
  const value = await operation();
  return { value, elapsedMs: performance.now() - started };
};
const optionalRead = async (path) => {
  try {
    return await readFile(path);
  } catch (cause) {
    if (cause.code === "ENOENT") return null;
    throw cause;
  }
};

export async function profileTranscript(record, payloads) {
  const payload = payloads.get(record.payloadDigest);
  const samplesMs = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    const measured = await measure(() => reconstructTranscript(payload.prompt, payloads));
    assert.equal(digestOfJson(measured.value), record.promptDigest);
    samplesMs.push(measured.elapsedMs);
  }
  return { samplesMs, promptDigest: record.promptDigest };
}

/** Repeat real retained inputs on private copies; never append to the original journals. */
export async function profileReplay(root, destination) {
  assert.equal(git("status", "--porcelain"), "", "measure a clean source revision");
  const report = await reportPilot(root);
  assert(report.completeSchedule, "finish the pilot before profiling its retained histories");
  const signal = AbortSignal.timeout(900000);
  await mkdir(destination, { mode: 0o700 });
  const measurements = [];
  const record = (name, subject, samplesMs, workload) =>
    measurements.push({ name, subject, samplesMs, workload });
  for (const slot of report.slots) {
    signal.throwIfAborted();
    const directory = join(root, "launches", slot.executionId.replace(/^sha256:/, ""));
    const peers = [];
    for (const sessionId of (await readdir(join(directory, "sessions"))).sort()) {
      const session = await openEvidenceSession({
        root: join(directory, "sessions"),
        sessionId,
        clock,
      });
      const subject = { executionId: slot.executionId, sessionId, head: session.head() };
      const records = session.records();
      const payloads = session.payloads();
      if (sessionId.startsWith("worker-"))
        peers.push({ workerId: sessionId, taskId: sessionId, chain: session });
      const calls = records.filter((entry) => entry.type === "model-call");
      const finalCall = calls.at(-1);
      if (finalCall) {
        const measured = await profileTranscript(finalCall, payloads);
        record("natural-transcript-reconstruction", subject, measured.samplesMs, {
          modelCalls: calls.length,
          promptDigest: measured.promptDigest,
          records: records.length,
        });
      }
      const citationSamples = [];
      const expectedIndex = indexCitedRecords(records, payloads);
      for (let repeat = 0; repeat < repeats; repeat++) {
        const measured = await measure(() => indexCitedRecords(records, payloads));
        assert.deepEqual(measured.value, expectedIndex);
        citationSamples.push(measured.elapsedMs);
      }
      record("natural-citation-index", subject, citationSamples, {
        records: records.length,
        digests: expectedIndex.size,
      });
      if (sessionId === "controller") {
        const state = replayController(session);
        const samples = [];
        for (let repeat = 0; repeat < repeats; repeat++) {
          const measured = await measure(() => replayController(session));
          assert.deepEqual(measured.value, state);
          samples.push(measured.elapsedMs);
        }
        record("natural-controller-replay", subject, samples, {
          records: records.length,
          graphObserved: state.graph !== null,
          candidates: state.candidates.size,
        });
        const bytes = await optionalRead(join(session.directory, "ownership.jsonl"));
        if (bytes) {
          const lines = bytes.toString("utf8").trimEnd().split("\n");
          const cold = [],
            polls = [],
            appends = [];
          for (let repeat = 0; repeat < repeats; repeat++) {
            signal.throwIfAborted();
            const path = join(destination, `${slot.executionId.slice(7)}-journal-${repeat}.jsonl`);
            await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
            const store = openRunStore(path);
            const measured = await measure(() => store.run(sessionId));
            assert(measured.value !== null);
            cold.push(measured.elapsedMs);
            const polled = await measure(() => {
              for (let count = 0; count < 200; count++) store.run(sessionId);
            });
            assert.deepEqual(store.run(sessionId), measured.value);
            polls.push(polled.elapsedMs);
            if (lines.length > 1) {
              const prefixPath = join(
                destination,
                `${slot.executionId.slice(7)}-prefix-${repeat}.jsonl`,
              );
              await writeFile(prefixPath, `${lines.slice(0, -1).join("\n")}\n`, {
                flag: "wx",
                mode: 0o600,
              });
              const prefix = openRunStore(prefixPath);
              prefix.run(sessionId);
              await appendFile(prefixPath, `${lines.at(-1)}\n`);
              const appended = await measure(() => prefix.run(sessionId));
              assert.deepEqual(appended.value, measured.value);
              assert.equal(digestOfBytes(await readFile(prefixPath)), digestOfBytes(bytes));
              appends.push(appended.elapsedMs);
            }
          }
          const workload = {
            bytes: bytes.length,
            digest: digestOfBytes(bytes),
            entries: lines.length,
          };
          record("natural-journal-cold-replay", subject, cold, workload);
          record("natural-journal-polls", subject, polls, { ...workload, readsPerSample: 200 });
          record("natural-journal-append-replay", subject, appends, workload);
        }
      }
    }
    const expected = projectTrail(peers);
    const peerSamples = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      const measured = await measure(() => projectTrail(peers));
      assert.deepEqual(measured.value, expected);
      peerSamples.push(measured.elapsedMs);
    }
    record("natural-peer-projection", { executionId: slot.executionId }, peerSamples, {
      workerChains: peers.length,
      signals: expected.signals.length,
    });
    const detection = await detectProject(
      async (path) => (await optionalRead(join(directory, "repo", path)))?.toString("utf8") ?? null,
    );
    const definitions = assembleGates(detection);
    const identity = (gates) =>
      gates.map((gate) => ({
        id: gate.id,
        severity: gate.severity,
        parser: gate.parserName ?? "exit-code",
        kind: gate.source.kind,
        command: gate.source.kind === "command" ? gate.source.command : null,
      }));
    const samples = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      const measured = await measure(() => {
        for (let count = 0; count < 1000; count++) assembleGates(detection);
      });
      assert.deepEqual(identity(assembleGates(detection)), identity(definitions));
      samples.push(measured.elapsedMs);
    }
    record("natural-gate-assembly", { executionId: slot.executionId }, samples, {
      detection,
      assembliesPerSample: 1000,
      gates: definitions.map((definition) => definition.id),
    });
  }
  assert.deepEqual(
    (await openEvidenceSession({ root: join(root, "sessions"), sessionId: "pilot", clock })).head(),
    report.campaignHead,
  );
  const result = {
    version: 1,
    sourceCommit: git("rev-parse", "HEAD"),
    campaignHead: report.campaignHead,
    protocolDigest: report.protocolDigest,
    repeats,
    measurements,
    environment: { node: process.version, platform: platform(), arch: arch(), release: release() },
    limitations: [
      "Repeated natural-data microbenchmarks, not independent goals or whole-run speed estimates.",
      "Cold journal reads use unique private copies. Polls verify the same bytes; append reads replay the exact final historical entry on a private prefix.",
      "Peer projection processes recorded worker chains before eligibility filtering and is never sent to a worker. Gate assembly reruns definitions, not check observations.",
      "Equality and digest checks occur after each timed operation. Unavailable journals and transcripts are absent measurements, not zero cost.",
    ],
  };
  const path = join(destination, "result.json");
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      path,
      digest: digestOfBytes(await readFile(path)),
      measurements: measurements.length,
    }),
  );
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [root, destination] = process.argv.slice(2);
  if (!root || !destination)
    throw new Error(
      "Supply a completed pilot directory and a new outside-workspace output directory",
    );
  await profileReplay(resolve(root), resolve(destination));
}
