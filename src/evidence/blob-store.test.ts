import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openBlobStore } from "./blob-store.ts";
import { digestOfBytes, digestPattern } from "./canonical-json.ts";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "swarm-blobs-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("content-addressed blob store", () => {
  it("keys a blob by the sha256 of its canonical bytes", async () => {
    const blobs = await openBlobStore(directory);

    const digest = await blobs.put({ tool: "shell", exitCode: 0 });

    expect(digest).toMatch(digestPattern);
    expect(digest).toBe(digestOfBytes('{"exitCode":0,"tool":"shell"}'));
    expect(await blobs.get(digest)).toEqual({ tool: "shell", exitCode: 0 });
  });

  it("writes the same content once, whatever key order it arrives in", async () => {
    const blobs = await openBlobStore(directory);

    const first = await blobs.put({ a: 1, b: 2 });
    const second = await blobs.put({ b: 2, a: 1 });

    expect(second).toBe(first);
    expect(await readdir(directory)).toHaveLength(1);
  });

  it("reports a missing blob as null rather than throwing", async () => {
    const blobs = await openBlobStore(directory);
    expect(await blobs.get(`sha256:${"0".repeat(64)}`)).toBeNull();
    expect(await blobs.bytes(`sha256:${"0".repeat(64)}`)).toBeNull();
  });
});
