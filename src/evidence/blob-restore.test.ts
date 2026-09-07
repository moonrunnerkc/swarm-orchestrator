import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreBlobs } from "./blob-restore.ts";

let root = "";
const digestOf = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "blob-restore-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function bundleWanting(payloads: readonly string[]): Promise<string> {
  const bundle = join(root, "bundle");
  await mkdir(join(bundle, "blobs"), { recursive: true });
  await writeFile(
    join(bundle, "blobs.digests.json"),
    JSON.stringify({
      version: 1,
      blobs: payloads.map((text) => ({
        name: `${digestOf(text).slice("sha256:".length)}.json`,
        digest: digestOf(text),
        bytes: Buffer.byteLength(text),
      })),
    }),
  );
  return bundle;
}

async function storeHolding(payloads: readonly string[]): Promise<string> {
  const store = join(root, "store", "session-1", "blobs");
  await mkdir(store, { recursive: true });
  for (const text of payloads) {
    await writeFile(join(store, `${digestOf(text).slice("sha256:".length)}.json`), text);
  }
  return join(root, "store");
}

describe("restoreBlobs", () => {
  it("copies every payload the manifest names back into the bundle", async () => {
    const payloads = ['{"a":1}', '{"b":2}'];
    const bundle = await bundleWanting(payloads);
    const store = await storeHolding(payloads);

    const restored = await restoreBlobs({ bundle, store });

    expect(restored.copied).toBe(2);
    expect(restored.missing).toEqual([]);
    const name = `${digestOf(payloads[0] as string).slice("sha256:".length)}.json`;
    expect(await readFile(join(bundle, "blobs", name), "utf8")).toBe(payloads[0]);
  });

  // A ledger payload is content addressed, so its filename is its digest (invariant 4). Anything
  // else in the manifest is a derived artifact, a rendered review page say, which the bundle can
  // be used to regenerate. Absent, the first stops a bundle verifying and the second does not, so
  // they are not reported as one number.
  it("separates an absent derived artifact from an absent payload", async () => {
    const bundle = join(root, "derived");
    await mkdir(join(bundle, "blobs"), { recursive: true });
    await writeFile(
      join(bundle, "blobs.digests.json"),
      JSON.stringify({
        version: 1,
        blobs: [{ name: "review.html", digest: digestOf("<html>"), bytes: 6 }],
      }),
    );

    const restored = await restoreBlobs({ bundle, store: join(root, "empty-store") });

    expect(restored.missing).toEqual([]);
    expect(restored.missingDerived).toEqual(["review.html"]);
  });

  it("names what it could not find rather than reporting a clean restore", async () => {
    const bundle = await bundleWanting(['{"a":1}', '{"gone":true}']);
    const store = await storeHolding(['{"a":1}']);

    const restored = await restoreBlobs({ bundle, store });

    expect(restored.copied).toBe(1);
    expect(restored.missing).toEqual([digestOf('{"gone":true}')]);
  });

  // A payload the bundle already holds is present, not missing. Reporting it as missing sends a
  // reader looking for a store to fix a bundle that verifies, which is a false alarm in the tool
  // built to tell absent evidence from failing evidence.
  it("counts a payload the bundle already holds as present rather than missing", async () => {
    const wanted = '{"a":1}';
    const bundle = await bundleWanting([wanted]);
    await writeFile(
      join(bundle, "blobs", `${digestOf(wanted).slice("sha256:".length)}.json`),
      wanted,
    );

    const restored = await restoreBlobs({ bundle, store: join(root, "empty-store") });

    expect(restored.missing).toEqual([]);
    expect(restored.alreadyPresent).toBe(1);
    expect(restored.copied).toBe(0);
  });

  // A restored copy that does not hash to the digest the bundle names is not that evidence, which
  // is the whole point of a content address. It is refused rather than written.
  it("refuses a candidate whose content does not match the digest it is filed under", async () => {
    const wanted = '{"a":1}';
    const bundle = await bundleWanting([wanted]);
    const store = join(root, "store", "session-1", "blobs");
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, `${digestOf(wanted).slice("sha256:".length)}.json`),
      '{"tampered":true}',
    );

    const restored = await restoreBlobs({ bundle, store: join(root, "store") });

    expect(restored.copied).toBe(0);
    expect(restored.corrupt).toEqual([digestOf(wanted)]);
    expect(restored.missing).toEqual([]);
  });
});
