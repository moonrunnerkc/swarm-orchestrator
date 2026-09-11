import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { verifyAcceptanceContract } from "./contract-verification.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
it.each(["passed", "assertion-failed", "unavailable"] as const)(
  "keeps every required obligation when the candidate observation is %s",
  async (candidate) => {
    const root = await mkdtemp(join(tmpdir(), "swarm-contract-"));
    roots.push(root);
    const evidence = await openEvidenceSession({
      root,
      sessionId: "contract",
      clock: { now: () => 0, sleep: async () => {} },
    });
    const digest = digestOfBytes("fixture");
    const verification = await verifyAcceptanceContract(
      {
        version: 1,
        author: "external fixture",
        taskId: "two obligations",
        exposure: "public",
        immutablePaths: [],
        requirements: ["implemented", "omitted"].map((id) => ({
          id,
          artifactDigest: digest,
          argv: ["node", "check.mjs"],
          severity: "required",
          applicable: true,
          referenceDigest: digest,
          violatingControlDigest: digest,
        })),
      },
      {
        evidence,
        execute: async (requirement, target) => {
          expect(evidence.records()[0]?.type).toBe("acceptance-contract");
          return {
            status:
              target === "reference"
                ? "passed"
                : target === "violating-control"
                  ? "assertion-failed"
                  : requirement.id === "implemented"
                    ? "passed"
                    : candidate,
            evidenceDigest: digest,
          };
        },
      },
    );
    expect(verification.accepted).toBe(candidate === "passed");
    expect(verification.obligations).toHaveLength(2);
  },
);
