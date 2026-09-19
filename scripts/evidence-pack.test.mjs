import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packDerivedArtifacts, packDirectoryName, verifyDerivedPack } from "./evidence-pack.mjs";
import { unpackArchive } from "./local-campaign/archive.mjs";

const sourceCommit = "0123456789abcdef0123456789abcdef01234567";
let repositoryRoot;

beforeEach(async () => {
  repositoryRoot = await mkdtemp(join(tmpdir(), "evidence-pack-"));
  const bundle = join(repositoryRoot, "evidence/run/bundle");
  await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, "review.html"), "<html>é rendered</html>\n");
  await writeFile(join(bundle, "run-transcript.txt"), "line one\nline two\n");
  await writeFile(join(bundle, "ledger.jsonl"), '{"sequence":1}\n');
  await writeFile(join(bundle, "reviewer.html"), "a near miss that is not derived\n");
});

afterEach(async () => {
  await rm(repositoryRoot, { recursive: true, force: true });
});

const pack = (overrides = {}) =>
  packDerivedArtifacts({
    repositoryRoot,
    root: "evidence",
    name: "first",
    trackedPaths: [
      "evidence/run/bundle/review.html",
      "evidence/run/bundle/run-transcript.txt",
      "evidence/run/bundle/ledger.jsonl",
      "evidence/run/bundle/reviewer.html",
    ],
    sourceCommit,
    ...overrides,
  });

describe("packing derived evidence", () => {
  it("restores the exact bytes of what it removed and leaves the records alone", async () => {
    const packed = await pack();
    expect(packed.files).toBe(2);

    const bundle = join(repositoryRoot, "evidence/run/bundle");
    expect((await readdir(bundle)).sort()).toEqual(["ledger.jsonl", "reviewer.html"]);

    const unpacked = await unpackArchive(packed.destination);
    try {
      expect(await readFile(join(unpacked.directory, "run/bundle/review.html"), "utf8")).toBe(
        "<html>é rendered</html>\n",
      );
      expect(
        await readFile(join(unpacked.directory, "run/bundle/run-transcript.txt"), "utf8"),
      ).toBe("line one\nline two\n");
    } finally {
      await unpacked.dispose();
    }
    expect(await verifyDerivedPack(packed.destination, repositoryRoot)).toMatchObject({
      ok: true,
      files: 2,
    });
  });

  it("never removes a file git has not seen", async () => {
    const packed = await pack({ trackedPaths: ["evidence/run/bundle/run-transcript.txt"] });
    expect(packed.files).toBe(1);
    expect(await readdir(join(repositoryRoot, "evidence/run/bundle"))).toContain("review.html");
  });

  it("writes nothing where there is nothing to pack", async () => {
    const packed = await pack({ trackedPaths: [] });
    expect(packed.files).toBe(0);
    expect(await readdir(join(repositoryRoot, "evidence"))).not.toContain(packDirectoryName);
  });

  it("refuses a second pack under a name already taken", async () => {
    await pack();
    await writeFile(join(repositoryRoot, "evidence/run/bundle/review.html"), "again\n");
    await expect(pack({ trackedPaths: ["evidence/run/bundle/review.html"] })).rejects.toThrow(
      /EEXIST/,
    );
  });

  it("refuses bytes that would not survive a text archive", async () => {
    await writeFile(
      join(repositoryRoot, "evidence/run/bundle/review.html"),
      Buffer.from([0xff, 0xfe, 0x00]),
    );
    await expect(pack()).rejects.toThrow(/not UTF-8/);
    expect(await readdir(join(repositoryRoot, "evidence/run/bundle"))).toContain("review.html");
  });
});

describe("verifying a pack", () => {
  it("names an archive that was altered after it was committed", async () => {
    const packed = await pack();
    await writeFile(join(packed.destination, "archive.json.br"), "tampered");
    const checked = await verifyDerivedPack(packed.destination, repositoryRoot);
    expect(checked.ok).toBe(false);
    expect(checked.problems[0]).toMatch(/digest mismatch/);
  });

  it("names an inventory edited to claim other bytes", async () => {
    const packed = await pack();
    const path = join(packed.destination, "inventory.json");
    const inventory = JSON.parse(await readFile(path, "utf8"));
    inventory.sources[0].digest = `sha256:${"0".repeat(64)}`;
    await writeFile(path, `${JSON.stringify(inventory, null, 2)}\n`);
    const checked = await verifyDerivedPack(packed.destination, repositoryRoot);
    expect(checked.problems).toContain(
      "the inventory inside the archive is not the committed inventory",
    );
  });

  it("accepts a file restored in place and refuses one that came back different", async () => {
    const packed = await pack();
    const path = join(repositoryRoot, "evidence/run/bundle/run-transcript.txt");
    await writeFile(path, "line one\nline two\n");
    expect((await verifyDerivedPack(packed.destination, repositoryRoot)).ok).toBe(true);
    await writeFile(path, "rewritten\n");
    expect((await verifyDerivedPack(packed.destination, repositoryRoot)).problems).toEqual([
      "run/bundle/run-transcript.txt is in the tree with bytes the inventory does not name",
    ]);
  });
});
