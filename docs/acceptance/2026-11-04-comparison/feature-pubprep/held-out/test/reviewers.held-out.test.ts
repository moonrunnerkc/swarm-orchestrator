// Held out from the agent: the acceptance test for pubprep's --reviewers option, written from the
// task's wording before either agent started.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs, USAGE } from "../src/cli.js";
import { orchestrate } from "../src/orchestrate.js";
import { createMockSdk } from "./fixtures/mock-sdk.js";

const ALL = ["tech-debt-reviewer", "readme-docs-reviewer", "security-reviewer"];

function errorOf(argv: string[]): string {
  try {
    parseArgs(argv);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`parseArgs accepted ${JSON.stringify(argv)}`);
}

describe("parseArgs --reviewers, held out", () => {
  it("leaves reviewers unset without the flag", () => {
    expect(parseArgs([]).reviewers).toBeUndefined();
  });

  it("maps short names to agent names in canonical order", () => {
    expect(parseArgs(["--reviewers", "security,tech-debt"]).reviewers).toEqual([
      "tech-debt-reviewer",
      "security-reviewer",
    ]);
    expect(parseArgs(["--reviewers", "docs"]).reviewers).toEqual(["readme-docs-reviewer"]);
  });

  it("keeps a repeated name once", () => {
    expect(parseArgs(["--reviewers", "docs,security,docs"]).reviewers).toEqual([
      "readme-docs-reviewer",
      "security-reviewer",
    ]);
  });

  it("rejects an empty list, naming the valid short names", () => {
    const message = errorOf(["--reviewers", ""]);
    for (const name of ["tech-debt", "docs", "security"]) expect(message).toContain(name);
  });

  it("rejects an unknown name, naming it and the valid short names", () => {
    const message = errorOf(["--reviewers", "docs,perf"]);
    expect(message).toContain("perf");
    for (const name of ["tech-debt", "docs", "security"]) expect(message).toContain(name);
  });

  it("rejects the flag without a value", () => {
    errorOf(["--reviewers"]);
  });

  it("documents the flag in --help", () => {
    expect(USAGE).toContain("--reviewers");
  });
});

describe("orchestrate reviewers, held out", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "pubprep-reviewers-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    writeFileSync(join(repo, "README.md"), "# fixture\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  for (const parallelReviewers of [true, false]) {
    it(`runs only the chosen reviewers (${parallelReviewers ? "parallel" : "sequential"})`, async () => {
      const mock = createMockSdk({
        "tech-debt-reviewer": { textChunks: ["TD report\n"] },
        "readme-docs-reviewer": { textChunks: ["DOCS report\n"] },
        "security-reviewer": { textChunks: ["SEC report\n"] },
      });
      const result = await orchestrate({
        projectRoot: repo,
        now: new Date(Date.UTC(2026, 10, 4, 12, 0, 0)),
        query: mock.query,
        dryRun: true,
        openPr: false,
        parallelReviewers,
        reviewers: ["security-reviewer"],
      });
      expect(result.exitReason).toBe("success");
      expect(mock.calls.map((call) => call.agentName)).toEqual(["security-reviewer"]);
      expect(existsSync(join(result.runDir, "security-output.md"))).toBe(true);
      expect(existsSync(join(result.runDir, "tech-debt-output.md"))).toBe(false);
      expect(existsSync(join(result.runDir, "readme-docs-output.md"))).toBe(false);
      const combined = readFileSync(join(result.runDir, "combined-review.md"), "utf8");
      expect(combined).toContain("SEC report");
      expect(combined).not.toContain("TD report");
      expect(combined).not.toContain("DOCS report");
    });
  }

  it("runs all three when no reviewers are given", async () => {
    const mock = createMockSdk({});
    await orchestrate({
      projectRoot: repo,
      now: new Date(Date.UTC(2026, 10, 4, 12, 0, 0)),
      query: mock.query,
      dryRun: true,
      openPr: false,
    });
    expect([...mock.calls.map((call) => call.agentName)].sort()).toEqual([...ALL].sort());
  });
});
