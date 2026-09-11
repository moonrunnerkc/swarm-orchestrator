import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { bundleSourceFromRecorder, exportBundle } from "./bundle.ts";
import { openEvidenceSession } from "./session.ts";
import { keyFingerprint } from "./signer-trust.ts";
import { signingKeyFromPkcs8 } from "./signing.ts";
import { verifyBundleAt } from "./verify-report.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "swarm-trusted-verification-"));
  roots.push(root);
  const clock = createTestClock(1);
  const evidence = await openEvidenceSession({ root, sessionId: "session", clock });
  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: { task: "fixture" },
  });
  const pair = generateKeyPairSync("ed25519");
  const key = signingKeyFromPkcs8(
    pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    "keychain",
  );
  const directory = join(root, "bundle");
  await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination: directory,
    signingKey: key,
    clock,
  });
  return { directory, signers: [keyFingerprint(key.publicKeySpki)] };
}

describe("installed bundle verification", () => {
  it("accepts intact evidence using an externally named signer", async () => {
    const { directory, signers } = await fixture();
    expect(await verifyBundleAt(directory, signers)).toMatchObject({
      integrity: "valid",
      exitCode: 0,
    });
  });

  it.each(["ledger", "blob", "missing-blob", "manifest", "missing-criteria"])(
    "refuses %s tampering",
    async (mutation) => {
      const { directory, signers } = await fixture();
      const manifestPath = join(directory, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (mutation === "ledger") {
        const path = join(directory, "ledger.jsonl");
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace('"timestamp":1', '"timestamp":2'),
        );
      } else if (mutation === "blob" || mutation === "missing-blob") {
        const path = join(directory, "blobs", `${manifest.blobs[0].slice(7)}.json`);
        if (mutation === "blob") await writeFile(path, "{}");
        else await rm(path);
      } else if (mutation === "manifest") {
        manifest.claims.unverified = 100;
        await writeFile(manifestPath, JSON.stringify(manifest));
      } else {
        const path = join(directory, "ledger.jsonl");
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace("session-started", "gate-run"),
        );
      }
      await writeFile(join(directory, "verify.mjs"), "process.exit(0);");
      expect((await verifyBundleAt(directory, signers)).exitCode).not.toBe(0);
    },
  );

  it("keeps signer trust distinct from intact evidence", async () => {
    const { directory } = await fixture();
    expect(await verifyBundleAt(directory, [`sha256:${"ab".repeat(32)}`])).toMatchObject({
      integrity: "valid",
      exitCode: 1,
    });
  });

  it("reads the historical format without granting it new guarantees", async () => {
    const { directory, signers } = await fixture();
    const path = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...manifest, bundleFormat: 1 }));
    expect((await verifyBundleAt(directory, signers)).exitCode).toBe(0);
  });
});
