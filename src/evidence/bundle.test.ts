import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { openBlobStore } from "./blob-store.ts";
import {
  BundleChainError,
  BundleScrubGateError,
  bundleSourceFromRecorder,
  exportBundle,
  readBundle,
} from "./bundle.ts";
import { openLedger } from "./ledger.ts";
import type { LedgerRecord } from "./ledger-record.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./session.ts";
import { createEphemeralSigningKey } from "./signing.ts";

const run = promisify(execFile);

let root = "";
let destination = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-bundle-"));
  destination = join(root, "bundle");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function recordedSession(): Promise<EvidenceRecorder> {
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "bundle-session",
    clock: createTestClock(1_700_000_000_000),
  });

  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: { task: "add a failing test and fix it" },
  });
  const { record } = await evidence.record({
    type: "tool-call",
    actor: "harness",
    provenance: ["model"],
    payload: {
      toolName: "shell",
      decision: "allowed",
      detail: "812 bytes returned",
      facts: { command: "npm test", exitCode: 0, stdoutBytes: 812 },
      tests: { collected: 47, failed: 0 },
    },
  });
  await evidence.submitClaim(
    {
      predicate: "tests.failed == 0 && tests.collected >= 47",
      record: record.payloadDigest,
      recordKind: "tool-call:shell",
      narrative: "the suite is green",
    },
    "test-model",
  );
  await evidence.submitClaim(
    {
      predicate: "tests.failed == 0",
      record: null,
      recordKind: "tool-call:shell",
      narrative: "trust me",
    },
    "test-model",
  );

  return evidence;
}

async function exportRecordedSession(): Promise<EvidenceRecorder> {
  const evidence = await recordedSession();
  await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination,
    signingKey: createEphemeralSigningKey(),
    clock: createTestClock(1_700_000_100_000),
  });
  return evidence;
}

/** Runs the bundle's own verifier the way a reviewer would: plain node, nothing installed. */
async function runEmbeddedVerifier(directory: string): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [join(directory, "verify.mjs"), directory],
      {
        cwd: directory,
      },
    );
    return { code: 0, output: stdout + stderr };
  } catch (cause) {
    const failure = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("bundle export", () => {
  it("writes the chain, the blobs, the DAG, a verifier, and a review page", async () => {
    await exportRecordedSession();

    for (const file of ["manifest.json", "ledger.jsonl", "dag.json", "verify.mjs", "review.html"]) {
      await expect(readFile(join(destination, file), "utf8")).resolves.toContain("");
    }
    const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
    expect(manifest.recordCount).toBe(4);
    expect(manifest.claims).toEqual({ verified: 1, unverified: 1 });
    expect(manifest.signature.algorithm).toBe("ed25519");
  });

  it("signs the chain head, which transitively covers every record", async () => {
    const evidence = await exportRecordedSession();
    const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));

    expect(manifest.chainHead).toBe(evidence.head().hash);
    expect(manifest.signature.value.length).toBeGreaterThan(0);
  });

  it("refuses to export a chain that does not verify", async () => {
    const evidence = await recordedSession();
    const records = [...evidence.records()];
    const second = records[1] as LedgerRecord;
    const tampered = [
      ...records.slice(0, 1),
      { ...second, actor: "someone-else" },
      ...records.slice(2),
    ];

    await expect(
      exportBundle({
        source: { sessionId: "x", records: tampered, blobBytes: () => Promise.resolve(null) },
        destination,
        signingKey: createEphemeralSigningKey(),
        clock: createTestClock(0),
      }),
    ).rejects.toThrow(BundleChainError);
  });

  it("runs the scrub gate a second time and stops if a blob still holds a credential", async () => {
    // Built without the recorder, so nothing scrubs on the way in: this is the state an
    // older session store or a missed pattern would leave behind.
    const blobs = await openBlobStore(join(root, "raw-blobs"));
    const ledger = await openLedger({
      path: join(root, "raw-ledger.jsonl"),
      clock: createTestClock(1_700_000_000_000),
    });
    const digest = await blobs.put({ output: "AWS_SECRET=AKIAIOSFODNN7EXAMPLE" });
    await ledger.append({
      type: "tool-call",
      actor: "harness",
      payloadDigest: digest,
      provenance: ["model"],
    });

    await expect(
      exportBundle({
        source: {
          sessionId: "leaky",
          records: ledger.records(),
          blobBytes: (key) => blobs.bytes(key),
        },
        destination,
        signingKey: createEphemeralSigningKey(),
        clock: createTestClock(0),
      }),
    ).rejects.toThrow(BundleScrubGateError);
  });

  it("shows unverified claims in the review page and only the verified one in green", async () => {
    await exportRecordedSession();
    const page = await readFile(join(destination, "review.html"), "utf8");

    expect(page).toContain("UNVERIFIED");
    expect(page).toContain("no-evidence-edge");
    expect(page).toContain('class="claim verified"');
    expect(page).toContain('class="claim unverified"');
    // The narrative is present, but labelled, and never inside a verified badge.
    expect(page).toContain("unverified prose");
  });
});

describe("the embedded verifier", () => {
  it("verifies a real bundle with plain node and nothing installed", async () => {
    await exportRecordedSession();

    const result = await runEmbeddedVerifier(destination);

    expect(result.output).toContain("bundle verified: every check passed");
    expect(result.code).toBe(0);
  });

  it("imports nothing outside node: builtins", async () => {
    await exportRecordedSession();
    const source = await readFile(join(destination, "verify.mjs"), "utf8");

    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((specifier) => specifier?.startsWith("node:"))).toBe(true);
  });

  it("fails when one byte of a ledger record is flipped", async () => {
    await exportRecordedSession();
    const ledgerPath = join(destination, "ledger.jsonl");
    const lines = (await readFile(ledgerPath, "utf8")).trim().split("\n");
    const first = lines[0] as string;
    // One hex character of the first record's payload digest, nothing else.
    lines[0] = first.replace(
      /("payloadDigest":"sha256:[0-9a-f]{63})([0-9a-f])"/,
      (_match, head: string, last: string) => `${head}${last === "0" ? "1" : "0"}"`,
    );
    expect(lines[0]).not.toBe(first);
    await writeFile(ledgerPath, `${lines.join("\n")}\n`, "utf8");

    const result = await runEmbeddedVerifier(destination);

    expect(result.code).toBe(1);
    expect(result.output).toContain("FAIL  hash chain intact");
  });

  it("fails when the last record is altered, which only the signature covers", async () => {
    await exportRecordedSession();
    const ledgerPath = join(destination, "ledger.jsonl");
    const lines = (await readFile(ledgerPath, "utf8")).trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1] as string);
    lines[lines.length - 1] = JSON.stringify({ ...last, timestamp: last.timestamp + 1 });
    await writeFile(ledgerPath, `${lines.join("\n")}\n`, "utf8");

    const result = await runEmbeddedVerifier(destination);

    expect(result.code).toBe(1);
    expect(result.output).toContain("FAIL  chain head matches the manifest");
  });

  it("fails when a blob is edited to say something the record never hashed", async () => {
    await exportRecordedSession();
    const bundle = await readBundle(destination);
    const digest = bundle.records[1]?.payloadDigest as string;
    const path = join(destination, "blobs", `${digest.replace("sha256:", "")}.json`);
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace('"failed":0', '"failed":9'),
      "utf8",
    );

    const result = await runEmbeddedVerifier(destination);

    expect(result.code).toBe(1);
    expect(result.output).toContain("FAIL  blobs match their content addresses");
  });

  it("recomputes claim verdicts rather than trusting the manifest", async () => {
    await exportRecordedSession();
    const manifestPath = join(destination, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, claims: { verified: 2, unverified: 0 } }, null, 2),
      "utf8",
    );

    const result = await runEmbeddedVerifier(destination);

    expect(result.code).toBe(1);
    expect(result.output).toContain("FAIL  claim verdicts recomputed");
    expect(result.output).toContain("1 verified, 1 unverified");
  });
});
