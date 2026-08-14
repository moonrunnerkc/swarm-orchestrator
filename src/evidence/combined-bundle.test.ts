import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { bundleSourceFromRecorder } from "./bundle.ts";
import { exportCombinedBundle } from "./combined-bundle.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./session.ts";
import { createEphemeralSigningKey } from "./signing.ts";

const run = promisify(execFile);
const clock = createTestClock(1_700_000_000_000);

let root = "";
let destination = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-combined-"));
  destination = join(root, "bundle");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function session(id: string): Promise<EvidenceRecorder> {
  return openEvidenceSession({ root: join(root, "sessions"), sessionId: id, clock });
}

/** A worker session with a gate record and a claim that holds against it. */
async function workerSession(id: string, collected: number): Promise<EvidenceRecorder> {
  const evidence = await session(id);
  const gate = await evidence.record({
    type: "gate-run",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { gateId: "tests", collected, failed: 0 },
  });
  await evidence.submitClaim(
    {
      predicate: `failed == 0 && collected == ${collected}`,
      record: gate.record.payloadDigest,
      recordKind: "gate-run:tests",
      narrative: `${id} left the suite green`,
    },
    "harness",
  );
  return evidence;
}

/** A coordinator that recorded each worker's chain head, which is what ties the bundle together. */
async function coordinatorFor(workers: readonly EvidenceRecorder[]): Promise<EvidenceRecorder> {
  const evidence = await session("coordinator");
  for (const worker of workers) {
    await evidence.record({
      type: "worker-finished",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        workerId: worker.sessionId,
        sessionId: worker.sessionId,
        chainHead: worker.head().hash,
        recordCount: worker.head().recordCount,
      },
    });
  }
  return evidence;
}

async function exportTwoWorkers() {
  const one = await workerSession("worker-one", 12);
  const two = await workerSession("worker-two", 7);
  const coordinator = await coordinatorFor([one, two]);

  const combined = await exportCombinedBundle({
    coordinator: bundleSourceFromRecorder(coordinator),
    workers: [
      { workerId: "one", source: bundleSourceFromRecorder(one) },
      { workerId: "two", source: bundleSourceFromRecorder(two) },
    ],
    destination,
    signingKey: createEphemeralSigningKey(),
    clock,
  });
  return { combined, one, two, coordinator };
}

/** Runs the bundle's own verifier the way a reviewer would: plain node, nothing installed. */
async function verify(directory: string): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [join(directory, "verify.mjs"), directory],
      { cwd: directory },
    );
    return { code: 0, output: stdout + stderr };
  } catch (cause) {
    const failure = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("exportCombinedBundle", () => {
  it("gives each worker its own bundle, complete enough to verify alone", async () => {
    await exportTwoWorkers();

    for (const workerId of ["one", "two"]) {
      const directory = join(destination, "workers", workerId);
      for (const file of ["manifest.json", "ledger.jsonl", "verify.mjs", "review.html"]) {
        await expect(readFile(join(directory, file), "utf8")).resolves.toContain("");
      }
      expect((await verify(directory)).code).toBe(0);
    }
  });

  it("lists every worker chain in the top-level manifest", async () => {
    const { one, two } = await exportTwoWorkers();
    const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));

    expect(manifest.workers).toEqual([
      {
        workerId: "one",
        sessionId: "worker-one",
        directory: "workers/one",
        chainHead: one.head().hash,
        recordCount: 2,
      },
      {
        workerId: "two",
        sessionId: "worker-two",
        directory: "workers/two",
        chainHead: two.head().hash,
        recordCount: 2,
      },
    ]);
  });

  it("verifies the whole thing, worker chains and all, with plain node", async () => {
    await exportTwoWorkers();

    const result = await verify(destination);

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/worker one/);
    expect(result.output).toMatch(/worker two/);
    expect(result.output).toContain("bundle verified");
  });

  it("fails when a worker's chain has been tampered with after export", async () => {
    await exportTwoWorkers();
    const ledger = join(destination, "workers", "one", "ledger.jsonl");
    const lines = (await readFile(ledger, "utf8")).split("\n");
    await writeFile(ledger, lines.slice(1).join("\n"), "utf8");

    const result = await verify(destination);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/worker one/);
  });

  it("fails when the coordinator never recorded a worker's chain head", async () => {
    // Without that record the worker bundle is merely adjacent to the run rather than part
    // of it, and the coordinator's signature would say nothing about it.
    const orphan = await workerSession("orphan", 3);
    const coordinator = await coordinatorFor([]);

    await exportCombinedBundle({
      coordinator: bundleSourceFromRecorder(coordinator),
      workers: [{ workerId: "orphan", source: bundleSourceFromRecorder(orphan) }],
      destination,
      signingKey: createEphemeralSigningKey(),
      clock,
    });

    const result = await verify(destination);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/no coordinator record/i);
  });

  it("still exports an ordinary bundle when there are no workers at all", async () => {
    const coordinator = await coordinatorFor([]);

    await exportCombinedBundle({
      coordinator: bundleSourceFromRecorder(coordinator),
      workers: [],
      destination,
      signingKey: createEphemeralSigningKey(),
      clock,
    });

    const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
    expect(manifest.workers).toEqual([]);
    expect((await verify(destination)).code).toBe(0);
  });
});
