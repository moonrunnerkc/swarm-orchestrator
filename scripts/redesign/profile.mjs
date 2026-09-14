import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const source = resolve(process.argv[2] ?? ".");
const destination = process.argv[3];
if (!destination)
  throw new Error("provide a source checkout and an outside-workspace output directory");
const directory = await mkdtemp(join(resolve(destination), "runtime-profile-"));
const from = (path) => import(pathToFileURL(join(source, path)).href);
const { digestOfBytes, digestOfJson, canonicalJson } = await from("src/evidence/canonical-json.ts");
const { openRunJournal } = await from("src/durable/run-journal.ts");
const { openEvidenceSession } = await from("src/evidence/session.ts");
const { recordTranscript, reconstructTranscript } = await from("src/evidence/transcript.ts");
const { indexCitedRecords } = await from("src/evidence/record-index.ts");
const { projectTrail } = await from("src/workers/trail.ts");
const { assembleGates } = await from("src/gates/default-gates.ts");
const { createResourcePool } = await from("src/exec/resource-pool.ts");
const measurements = [];
const repetitions = 7;
const elapsed = async (operation) => {
  const start = performance.now();
  await operation();
  return performance.now() - start;
};
const capture = (name, samplesMs, workload, observation) =>
  measurements.push({
    name,
    samplesMs,
    medianMs: [...samplesMs].sort((a, b) => a - b)[Math.floor(samplesMs.length / 2)],
    workload,
    observation,
  });
const clock = { now: () => 0, sleep: async () => {} };

try {
  let sequence = 0;
  let head = "genesis";
  const line = () => {
    const encoded = {
      sequence,
      previousHash: head,
      operation: "fixed-profile-fixture",
      projection: {
        items: {
          [`item-${sequence % 64}`]: { sequence, text: "plain fixture content ".repeat(16) },
        },
      },
    };
    const serialized = JSON.stringify({ ...encoded, hash: digestOfBytes(JSON.stringify(encoded)) });
    head = digestOfBytes(serialized);
    sequence++;
    return `${serialized}\n`;
  };
  const journalBytes = Array.from({ length: 12000 }, line).join("");
  const originalHead = head;
  const cold = [],
    polls = [],
    appends = [],
    updates = [];
  for (let repeat = 0; repeat < repetitions; repeat++) {
    const filename = join(directory, `journal-${repeat}.jsonl`);
    writeFileSync(filename, journalBytes, { mode: 0o600 });
    const journal = openRunJournal(
      filename,
      () => ({ items: {} }),
      (projection) => projection,
    );
    cold.push(await elapsed(() => assert.equal(Object.keys(journal.read().items).length, 64)));
    polls.push(
      await elapsed(() => {
        for (let read = 0; read < 200; read++)
          assert.equal(Object.keys(journal.read().items).length, 64);
      }),
    );
    sequence = 12000;
    head = originalHead;
    appends.push(
      await elapsed(() => {
        for (let append = 0; append < 50; append++) {
          const expected = sequence;
          appendFileSync(filename, line());
          assert.equal(journal.read().items[`item-${expected % 64}`].sequence, expected);
        }
      }),
    );
    updates.push(
      await elapsed(() => {
        for (let update = 0; update < 30; update++)
          journal.update("profile-own-update", (projection) => {
            projection.items.owned = { iteration: update };
          });
      }),
    );
    assert.equal(journal.read().items.owned.iteration, 29);
  }
  const journalFixture = {
    entries: 12000,
    bytes: Buffer.byteLength(journalBytes),
    digest: digestOfBytes(journalBytes),
    projectionItems: 64,
  };
  capture(
    "journal-cold-replay",
    cold,
    journalFixture,
    "64 fields reconstructed from checked links",
  );
  capture(
    "journal-administrative-polls",
    polls,
    { ...journalFixture, reads: 200 },
    "every read still checks the on-disk bytes; 200 reads equal forty seconds at the current polling interval",
  );
  capture(
    "journal-external-append-replay",
    appends,
    { ...journalFixture, appendedReads: 50 },
    "each independently appended delta becomes visible immediately",
  );
  capture(
    "journal-owned-update",
    updates,
    { ...journalFixture, updates: 30 },
    "thirty journal updates retain their final projection",
  );

  const transcripts = [],
    reconstruction = [],
    citations = [],
    peers = [];
  for (let repeat = 0; repeat < repetitions; repeat++) {
    const evidence = await openEvidenceSession({
      root: directory,
      sessionId: `transcript-${repeat}`,
      clock,
    });
    const messages = [];
    let reference;
    let prompt;
    transcripts.push(
      await elapsed(async () => {
        for (let turn = 0; turn < 180; turn++) {
          messages.push({
            role: "user",
            text: `${turn}: ${"fixed transcript words ".repeat(100)}`,
          });
          prompt = {
            system: "fixed profile instruction",
            tools: [],
            messages: [...messages],
            maxOutputTokens: 100,
            sampling: null,
          };
          reference = await recordTranscript(evidence, prompt);
        }
      }),
    );
    assert.equal(evidence.records().length, 182);
    reconstruction.push(
      await elapsed(() => {
        for (let read = 0; read < 50; read++)
          assert.equal(
            canonicalJson(reconstructTranscript(reference, evidence.payloads())),
            canonicalJson(prompt),
          );
      }),
    );
    const records = [],
      payloads = new Map();
    for (let index = 0; index < 12000; index++) {
      const payload =
        index % 50 === 0
          ? {
              gateId: "tests",
              status: "failed",
              exitCode: 1,
              detail: `fixture failure ${index % 200}`,
            }
          : { toolName: "read", text: `fixture ${index}` };
      const payloadDigest = digestOfJson(payload);
      payloads.set(payloadDigest, payload);
      records.push({
        sequence: index,
        actor: "harness",
        type: index % 50 === 0 ? "gate-run" : "tool-call",
        payloadDigest,
      });
    }
    citations.push(
      await elapsed(() => {
        for (let read = 0; read < 100; read++)
          assert.equal(indexCitedRecords(records, payloads).size, payloads.size);
      }),
    );
    const trailPeers = Array.from({ length: 3 }, (_, id) => ({
      workerId: `worker-${id}`,
      taskId: `task-${id}`,
      chain: { sessionId: `session-${id}`, records: () => records, payloads: () => payloads },
    }));
    const expected = projectTrail(trailPeers);
    assert.equal(expected.signals.length, 12);
    assert(
      expected.signals.every(
        (signal) => signal.kind === "gate-failed" && signal.exitCode === 1 && signal.repeats === 60,
      ),
    );
    peers.push(
      await elapsed(() => {
        for (let read = 0; read < 100; read++) assert.deepEqual(projectTrail(trailPeers), expected);
      }),
    );
  }
  capture(
    "transcript-record-growing-prefix",
    transcripts,
    { turns: 180, messageCharacters: 2200, records: 182 },
    "one component per new message, exact final prompt reconstruction",
  );
  capture(
    "transcript-reconstruct",
    reconstruction,
    { messages: 180, reads: 50 },
    "canonical bytes match the original prompt each time",
  );
  capture(
    "claim-citation-index",
    citations,
    { records: 12000, reads: 100 },
    "all digest carriers retained",
  );
  capture(
    "peer-trail-projection",
    peers,
    { peers: 3, recordsPerPeer: 12000, reads: 100 },
    "folded negative observations identical on every read",
  );

  const definitions = [];
  const detection = {
    types: ["node"],
    manifests: ["package.json"],
    nodeScripts: ["test", "typecheck", "lint"],
    nodeScriptCommands: { test: "node --test", typecheck: "tsc --noEmit", lint: "biome check" },
    pythonTools: [],
  };
  for (let repeat = 0; repeat < repetitions; repeat++)
    definitions.push(
      await elapsed(() => {
        for (let assemble = 0; assemble < 10000; assemble++)
          assert(
            assembleGates(detection).some(
              (gate) => gate.id === "tests" && gate.severity === "blocking",
            ),
          );
      }),
    );
  capture(
    "immutable-check-assembly",
    definitions,
    { assemblies: 10000, detection },
    "required tests retained; no observations cached",
  );

  const shared = [],
    separate = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const separated of repeat % 2 ? [true, false] : [false, true]) {
      const model = createResourcePool(1);
      const tests = separated ? createResourcePool(1) : model;
      let calls = 0,
        checks = 0;
      const duration = await elapsed(() =>
        Promise.all(
          Array.from({ length: 8 }, async () => {
            await model.run(async () => {
              await sleep(25);
              calls++;
            });
            await tests.run(async () => {
              await sleep(25);
              checks++;
            });
          }),
        ),
      );
      assert.equal(calls, 8);
      assert.equal(checks, 8);
      (separated ? separate : shared).push(duration);
    }
  }
  capture(
    "synthetic-shared-resource-permit",
    shared,
    { activities: 8, modelDelayMs: 25, testDelayMs: 25 },
    "synthetic scheduling only; this is not measured model-server throughput",
  );
  capture(
    "synthetic-separate-resource-permits",
    separate,
    { activities: 8, modelDelayMs: 25, testDelayMs: 25 },
    "same sixteen activities, separate limits of one",
  );
  console.log(
    JSON.stringify(
      {
        version: 1,
        source,
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: source,
          encoding: "utf8",
        }).trim(),
        patchDigest: digestOfBytes(
          execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: source, maxBuffer: 64000000 }),
        ),
        scriptDigest: digestOfBytes(readFileSync(new URL(import.meta.url))),
        environment: {
          node: process.version,
          platform: platform(),
          release: release(),
          arch: arch(),
        },
        repetitions,
        measurements,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
