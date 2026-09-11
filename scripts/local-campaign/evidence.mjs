import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { bundleSourceFromRecorder, exportBundle } from "../../src/evidence/bundle.ts";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { createEphemeralSigningKey } from "../../src/evidence/signing.ts";

export const clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};
export const campaignRoot = resolve(
  process.env.SWARM_CAMPAIGN_ROOT ?? join(homedir(), ".swarm", "local-campaign-2026-09-11"),
);
export const image = "node:24-bookworm";

export async function session(id) {
  return openEvidenceSession({ root: join(campaignRoot, "sessions"), sessionId: id, clock });
}

export async function record(evidence, phase, payload) {
  const captured = await evidence.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { phase, ...payload },
  });
  return captured.record.payloadDigest;
}

export async function save(name, value) {
  const destination = join(campaignRoot, name);
  await mkdir(resolve(destination, ".."), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export async function load(name) {
  return JSON.parse(await readFile(join(campaignRoot, name), "utf8"));
}

export async function exportSession(evidence) {
  return exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination: join(campaignRoot, "bundles", evidence.sessionId),
    signingKey: createEphemeralSigningKey(),
    clock,
  });
}

export async function sourceIdentity(paths) {
  return Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, digestOfBytes(await readFile(path))])),
  );
}
