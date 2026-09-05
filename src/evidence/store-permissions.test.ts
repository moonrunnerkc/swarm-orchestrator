import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openBlobStore } from "./blob-store.ts";
import { openLedger } from "./ledger.ts";
import { createEphemeralSigningKey } from "./signing.ts";

/**
 * The session store holds every prompt, every tool argument, and every file the run read. It
 * lives outside the workspace precisely so the workspace cannot reach it, and then it was
 * created at whatever the operator's umask allowed: on a shared machine, world-readable.
 */
let root = "";
let umaskBefore = 0;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-store-perms-"));
  // The permissive umask is the point: the mode has to be asked for, not left to inherit.
  umaskBefore = process.umask(0o000);
});

afterEach(async () => {
  process.umask(umaskBefore);
  await rm(root, { recursive: true, force: true });
});

const ownerOnly = (mode: number) => (mode & 0o777).toString(8);

describe("who can read a session store", () => {
  it("creates the blob directory readable by its owner alone", async () => {
    const directory = join(root, "blobs");
    await openBlobStore(directory);

    expect(ownerOnly((await stat(directory)).mode)).toBe("700");
  });

  it("creates a blob readable by its owner alone", async () => {
    const store = await openBlobStore(join(root, "blobs"));
    const digest = await store.put({ prompt: "a secret the run was given" });

    expect(ownerOnly((await stat(store.pathFor(digest))).mode)).toBe("600");
  });

  it("creates the ledger directory and its chain readable by their owner alone", async () => {
    const path = join(root, "session", "ledger.jsonl");
    const ledger = await openLedger({
      path,
      clock: { now: () => 0, sleep: () => Promise.resolve() },
    });
    await ledger.append({
      type: "session-started",
      actor: "harness",
      payloadDigest: `sha256:${"ab".repeat(32)}`,
      provenance: ["user"],
    });

    expect(ownerOnly((await stat(join(root, "session"))).mode)).toBe("700");
    expect(ownerOnly((await stat(path)).mode)).toBe("600");
  });
});

describe("who can read an exported bundle", () => {
  it("writes the export owner-only, since it carries the same prompts and file contents", async () => {
    const { exportBundle } = await import("./bundle.ts");
    const session = join(root, "session");
    const ledger = await openLedger({
      path: join(session, "ledger.jsonl"),
      clock: { now: () => 0, sleep: () => Promise.resolve() },
    });
    const blobs = await openBlobStore(join(session, "blobs"));
    await ledger.append({
      type: "session-started",
      actor: "harness",
      payloadDigest: await blobs.put({ task: "a task the operator typed" }),
      provenance: ["user"],
    });

    const destination = join(root, "bundle");
    await exportBundle({
      source: {
        sessionId: "permissions",
        records: ledger.records(),
        blobBytes: (digest) => blobs.bytes(digest),
      },
      destination,
      clock: { now: () => 0, sleep: () => Promise.resolve() },
      signingKey: createEphemeralSigningKey(),
    });

    expect(ownerOnly((await stat(destination)).mode)).toBe("700");
    expect(ownerOnly((await stat(join(destination, "manifest.json"))).mode)).toBe("600");
  });
});
