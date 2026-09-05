import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBlobManifest,
  offloadBlobs,
  offloadDerivedArtifacts,
  restoreVerification,
  verifyAgainstManifest,
} from "./blob-manifest.ts";

let bundle = "";

beforeEach(async () => {
  bundle = await mkdtemp(join(tmpdir(), "swarm-blob-manifest-"));
  await mkdir(join(bundle, "blobs"), { recursive: true });
  await writeFile(join(bundle, "manifest.json"), '{"chainHead":"sha256:aa"}\n');
  await writeFile(join(bundle, "blobs", "sha256-01.json"), '{"a":1}');
  await writeFile(join(bundle, "blobs", "sha256-02.json"), '{"b":2}');
});

afterEach(async () => {
  await rm(bundle, { recursive: true, force: true });
});

/**
 * Bulk evidence blobs are the whole of the repository's weight. They can live somewhere else,
 * but only if what is left behind is enough to say whether a restored copy is the same bytes:
 * an offload without a digest is a deletion with a promise attached.
 */
describe("moving bulk evidence out of the repository", () => {
  it("records a digest and a size for every blob", async () => {
    const manifest = await buildBlobManifest(join(bundle, "blobs"));

    expect(manifest.blobs).toHaveLength(2);
    expect(manifest.blobs[0]?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.totalBytes).toBeGreaterThan(0);
  });

  it("verifies a directory that still holds exactly those bytes", async () => {
    const manifest = await buildBlobManifest(join(bundle, "blobs"));

    expect((await verifyAgainstManifest(join(bundle, "blobs"), manifest)).verified).toBe(true);
  });

  it("refuses a directory where a blob's content changed", async () => {
    const manifest = await buildBlobManifest(join(bundle, "blobs"));
    await writeFile(join(bundle, "blobs", "sha256-01.json"), '{"a":2}');

    const checked = await verifyAgainstManifest(join(bundle, "blobs"), manifest);

    expect(checked.verified).toBe(false);
    expect(checked.mismatched).toContain("sha256-01.json");
  });

  it("refuses a directory where a blob is missing, rather than passing on what is left", async () => {
    const manifest = await buildBlobManifest(join(bundle, "blobs"));
    await rm(join(bundle, "blobs", "sha256-02.json"));

    const checked = await verifyAgainstManifest(join(bundle, "blobs"), manifest);

    expect(checked.verified).toBe(false);
    expect(checked.missing).toContain("sha256-02.json");
  });

  it("leaves the manifest behind when it removes the blobs, never the other way round", async () => {
    await offloadBlobs(join(bundle, "blobs"));

    expect(await readdir(bundle)).toContain("blobs.digests.json");
    expect(await readdir(join(bundle, "blobs")).catch(() => [])).toEqual([]);
  });

  it("says how to check a restored copy, in the file it leaves behind", async () => {
    const offloaded = await offloadBlobs(join(bundle, "blobs"));

    expect(offloaded.manifest.note).toMatch(/restore/i);
    expect(restoreVerification(join(bundle, "blobs"))).toContain("blobs.digests.json");
  });

  it("refuses to offload a directory it has not written a manifest for", async () => {
    await expect(offloadBlobs(join(bundle, "no-such-directory"))).rejects.toThrow(/no blobs/i);
  });
});

describe("moving large derived artifacts out too", () => {
  it("offloads a rendered page and records its digest beside it", async () => {
    await writeFile(join(bundle, "review.html"), "x".repeat(300_000));

    const offloaded = await offloadDerivedArtifacts(bundle, { overBytes: 100_000 });

    expect(offloaded.offloaded.map((one) => one.name)).toContain("review.html");
    expect(offloaded.manifest?.blobs.some((entry) => entry.name === "review.html")).toBe(true);
  });

  it("never offloads the evidence itself, whatever its size", async () => {
    // The chain and the DAG are the evidence. A rendered page is a view of them, and a
    // transcript is a log beside them; those can live elsewhere and these cannot.
    await writeFile(join(bundle, "ledger.jsonl"), "y".repeat(300_000));
    await writeFile(join(bundle, "dag.json"), "z".repeat(300_000));

    const offloaded = await offloadDerivedArtifacts(bundle, { overBytes: 100_000 });

    expect(offloaded.offloaded.map((one) => one.name)).not.toContain("ledger.jsonl");
    expect(offloaded.offloaded.map((one) => one.name)).not.toContain("dag.json");
  });

  it("leaves a small derived artifact alone, because the weight is what this is about", async () => {
    await writeFile(join(bundle, "review.html"), "small");

    const offloaded = await offloadDerivedArtifacts(bundle, { overBytes: 100_000 });

    expect(offloaded.offloaded).toHaveLength(0);
  });
});

describe("what this must never delete", () => {
  /**
   * This removed 89 MB of somebody's uncommitted corpus once. Nothing in the logic objected,
   * because the logic was about size and the question was about ownership: deleting is only
   * recoverable through git history, and a file history has never seen cannot be put back.
   */
  it("leaves a file the caller says is untracked, however large", async () => {
    await writeFile(join(bundle, "review.html"), "x".repeat(300_000));

    const offloaded = await offloadDerivedArtifacts(bundle, {
      overBytes: 100_000,
      keepUntracked: (name) => name === "review.html",
    });

    expect(offloaded.offloaded).toHaveLength(0);
    expect(await readdir(bundle)).toContain("review.html");
  });
});
