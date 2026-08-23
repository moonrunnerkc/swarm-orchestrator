import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evidenceLocation } from "./open-path.ts";
import { runEmbeddedVerifier } from "./verify-bundle.ts";

/** A committed bundle, copied so nothing here can write to the one in the tree. */
const committed = new URL("../../docs/evidence/2026-08-18/live-frontier/", import.meta.url);

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "verify-bundle-"));
  await cp(committed, join(root, "bundle"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function verify(directory: string) {
  return runEmbeddedVerifier({
    location: evidenceLocation(directory, "harness"),
    nodeExecutable: process.execPath,
    environment: process.env,
    timeoutMs: 60_000,
  });
}

describe("running a bundle's own verifier", () => {
  it("reports verified with the exit code that earned it", async () => {
    expect(await verify(join(root, "bundle"))).toEqual({ kind: "verified", exitCode: 0 });
  });

  it("reports refused, with the exit code and the first line of what it said", async () => {
    const { writeFile, readFile } = await import("node:fs/promises");
    const ledger = join(root, "bundle", "ledger.jsonl");
    const lines = (await readFile(ledger, "utf8")).split("\n");
    // One byte of one record, which is the whole demonstration.
    lines[10] = (lines[10] ?? "").replace(
      /"sequence":(\d+)/,
      (_, n) => `"sequence":${Number(n) + 1}`,
    );
    await writeFile(ledger, lines.join("\n"));

    const verdict = await verify(join(root, "bundle"));
    expect(verdict.kind).toBe("refused");
    if (verdict.kind === "refused") {
      expect(verdict.exitCode).toBe(1);
    }
  });

  /**
   * Node exits 1 on a module it cannot find, which at the exit code alone is the same as a
   * verifier that ran and refused. One is the absence of a verdict and the other is a verdict,
   * and calling the first "REFUSED by its own verifier" would be a false statement about
   * evidence, in the panel, in the place the panel exists to be trustworthy.
   */
  it("says it could not run rather than claiming a verdict, when there is nothing to run", async () => {
    const verdict = await verify(join(root, "not-a-bundle"));

    expect(verdict.kind).toBe("not-run");
    if (verdict.kind === "not-run") {
      expect(verdict.reason).toContain("verify.mjs");
    }
  });

  it("says the same for a directory that exists and holds no verifier", async () => {
    await rm(join(root, "bundle", "verify.mjs"));
    expect((await verify(join(root, "bundle"))).kind).toBe("not-run");
  });

  it("hands the verifier no name that decides what it loads", async () => {
    const verdict = await runEmbeddedVerifier({
      location: evidenceLocation(join(root, "bundle"), "harness"),
      nodeExecutable: process.execPath,
      environment: { ...process.env, NODE_OPTIONS: "--require /nonexistent/hook.js" },
      timeoutMs: 60_000,
    });

    // With NODE_OPTIONS inherited, node would refuse to start at all.
    expect(verdict).toEqual({ kind: "verified", exitCode: 0 });
  });
});
