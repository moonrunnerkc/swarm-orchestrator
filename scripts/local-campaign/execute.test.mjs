import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { frozenBase, readCampaignSource, verifySource, workspaceFor } from "./execute.mjs";

it.each(["solution.test.mjs", "unexpected.mjs"])(
  "does not discard a produced change to %s before grading",
  async (path) => {
    const root = await mkdtemp(join(tmpdir(), "campaign-whole-patch-"));
    const one = { publicChecks: [{ input: 1, expected: 2 }] };
    const workspace = await workspaceFor(one, "whole-patch-test");
    try {
      const evidence = await openEvidenceSession({
        root,
        sessionId: "test",
        clock: { now: () => 0, sleep: async () => {} },
      });
      const source = "export function solve(input) { return input + 1; }\n";
      await writeFile(join(workspace, "solution.mjs"), source);
      await writeFile(join(workspace, path), "export const unrelated = true;\n");
      const observed = await verifySource(evidence, one, source, "whole-patch", {
        workspace,
        baseCommit: frozenBase(workspace),
      });
      expect(observed.verified).toBe(false);
      expect(observed.refusal).toContain(path);
      expect(observed.applied).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

it("refuses a source symlink and an oversized source before reading candidate bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "campaign-source-boundary-"));
  try {
    const external = join(root, "outside-canary");
    await writeFile(external, "synthetic outside value");
    await symlink(external, join(root, "solution.mjs"));
    await expect(readCampaignSource(root)).rejects.toThrow();
    await rm(join(root, "solution.mjs"));
    await writeFile(join(root, "solution.mjs"), "x".repeat(30001));
    await expect(readCampaignSource(root)).rejects.toThrow("30000 bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
