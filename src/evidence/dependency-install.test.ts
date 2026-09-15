import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bundleSourceFromRecorder, exportBundle } from "./bundle.ts";
import { openEvidenceSession } from "./session.ts";
import { createEphemeralSigningKey } from "./signing.ts";
import { verifyBundle } from "./verifier/verify.mjs";

it.each([true, false])(
  "independently re-derives setup success from captured process and source observations (%s)",
  async (honest) => {
    const root = await mkdtemp(join(tmpdir(), "setup-verifier-"));
    const clock = { now: () => 1, sleep: async () => {} };
    try {
      const evidence = await openEvidenceSession({ root, sessionId: "setup", clock });
      const identity = {
        version: 1,
        id: "setup-1",
        workspace: "/owned/checkout",
        argv: ["npm", "ci", "--ignore-scripts"],
        lockDigest: `sha256:${"1".repeat(64)}`,
        sourceDigest: `sha256:${"2".repeat(64)}`,
      };
      await evidence.record({
        type: "dependency-install",
        actor: "harness",
        provenance: ["user"],
        payload: { ...identity, phase: "intent" },
      });
      await evidence.record({
        type: "dependency-install",
        actor: "harness",
        provenance: ["tool-output"],
        payload: {
          ...identity,
          phase: "completed",
          sourceAfter: identity.sourceDigest,
          exitCode: 1,
          unavailable: null,
          succeeded: !honest,
          detail: "captured command refused",
        },
      });
      const destination = join(root, "bundle");
      await exportBundle({
        source: bundleSourceFromRecorder(evidence),
        destination,
        signingKey: createEphemeralSigningKey(),
        clock,
      });
      const lines: string[] = [];
      const status = verifyBundle(destination, (line: string) => lines.push(line));
      expect(status === 0, lines.join("\n")).toBe(honest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
