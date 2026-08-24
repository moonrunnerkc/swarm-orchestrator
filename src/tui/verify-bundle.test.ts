import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evidenceLocation } from "./open-path.ts";
import { refusalDetail, runEmbeddedVerifier } from "./verify-bundle.ts";

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
      // The defect this covers: the detail was read off stderr, and the verifier reports
      // through console.log, so every real refusal said "no detail given" at the one moment
      // the panel exists for. This asserts against a bundle actually tampered with above,
      // rather than against a hand-written string.
      expect(verdict.detail).not.toBe("no detail given");
      expect(verdict.detail).toContain("FAIL");
      expect(verdict.detail.toLowerCase()).toContain("chain");
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

describe("which line of a refusal a reader is given", () => {
  it("prefers the named check over the tally under it", () => {
    const stdout = [
      "  PASS  ledger parses: 42 of 42 lines",
      "  FAIL  hash chain intact: record 11 does not follow record 10",
      "",
      "bundle FAILED: 1 check(s) did not pass",
    ].join("\n");

    expect(refusalDetail(stdout, "")).toContain("hash chain intact");
  });

  it("counts the rest rather than showing one of several as if it were all", () => {
    const stdout = ["  FAIL  a: one", "  FAIL  b: two", "  FAIL  c: three"].join("\n");

    expect(refusalDetail(stdout, "")).toContain("(and 2 more)");
  });

  it("falls back to the verdict line when no check names itself", () => {
    expect(refusalDetail("bundle FAILED: 3 check(s) did not pass", "")).toBe(
      "bundle FAILED: 3 check(s) did not pass",
    );
  });

  /** Node failing to start is not the bundle refusing, and stderr is where that shows up. */
  it("still reads stderr, which is where node itself complains", () => {
    expect(refusalDetail("", "SyntaxError: Unexpected token")).toBe(
      "SyntaxError: Unexpected token",
    );
  });

  it("says so plainly when neither stream said anything", () => {
    expect(refusalDetail("", "")).toBe("no detail given");
  });
});
