kind: feature

```test
/**
 * Behaviors to check:
 * 1. --reviewers option added to pubprep.
 * 2. --reviewers takes a comma-separated list of short names: tech-debt, docs, security.
 * 3. parseArgs returns the choice as `reviewers` using full agent names: tech-debt-reviewer, readme-docs-reviewer, security-reviewer.
 * 4. parseArgs ensures the order is always tech-debt, docs, security regardless of input order.
 * 5. parseArgs ensures each reviewer appears only once even when repeated in input.
 * 6. parseArgs leaves `reviewers` unset if the flag is not provided.
 * 7. parseArgs returns an error naming the valid short names if the value is missing or empty.
 * 8. parseArgs returns an error naming the invalid name and the valid short names if a name is not one of the three.
 * 9. main passes the parsed reviewers list to orchestrate.
 * 10. orchestrate takes the reviewers list as an optional parameter.
 * 11. orchestrate runs only the specified reviewers (verified via main -> orchestrate call).
 * 12. --help text documents the --reviewers flag.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

vi.mock("../src/claude-code.js", () => ({
  findClaudeCodeBinary: vi.fn(() => null),
}));

vi.mock("../src/orchestrate.js", () => ({
  orchestrate: vi.fn(),
}));

import { findClaudeCodeBinary } from "../src/claude-code.js";
import { main, parseArgs } from "../src/cli.js";
import { orchestrate } from "../src/orchestrate.js";

const findBinaryMock = vi.mocked(findClaudeCodeBinary);
const orchestrateMock = vi.mocked(orchestrate);

function makeCleanRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pubprep-cli-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), ".pubprep/\n.env\n");
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

function successfulOrchestrate(): Awaited<ReturnType<typeof orchestrate>> {
  return {
    runDir: "/tmp/run",
    manifestPath: "/tmp/run/manifest.json",
    exitReason: "success",
    manifest: {
      run_id: "test-run",
      started_at: "2026-05-22T00:00:00Z",
      finished_at: "2026-05-22T00:01:00Z",
      target_repo: "/tmp/run",
      target_head_sha: "deadbeef",
      agents: [],
      convergence_branch: null,
      exit_reason: "success",
      publish_gate: null,
      pull_request: null,
      warnings: [],
    },
  };
}

describe("pubprep --reviewers", () => {
  let stdoutSpy: MockInstance<(chunk: string) => boolean>;
  let stderrSpy: MockInstance<(chunk: string) => boolean>;
  let originalApiKey: string | undefined;
  let repo: string | null;
  let fakeHome: string;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true) as MockInstance<(chunk: string) => boolean>;
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true) as MockInstance<(chunk: string) => boolean>;
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    findBinaryMock.mockReset();
    findBinaryMock.mockReturnValue(null);
    orchestrateMock.mockReset();
    orchestrateMock.mockResolvedValue(successfulOrchestrate());
    repo = null;
    fakeHome = mkdtempSync(join(tmpdir(), "pubprep-cli-home-"));
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
    if (repo !== null) {
      rmSync(repo, { recursive: true, force: true });
    }
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function stdoutText(): string {
    return stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
  }
  function stderrText(): string {
    return stderrSpy.mock.calls.map((c) => String(c[0])).join("");
  }

  describe("parseArgs()", () => {
    it("returns reviewers as full agent names in the correct order", () => {
      const args = ["--reviewers", "docs,tech-debt,security"];
      const parsed = parseArgs(args);
      expect(parsed.reviewers).toEqual([
        "tech-debt-reviewer",
        "readme-docs-reviewer",
        "security-reviewer",
      ]);
    });

    it("removes duplicate reviewers and maintains correct order", () => {
      const args = ["--reviewers", "security,docs,security,tech-debt,docs"];
      const parsed = parseArgs(args);
      expect(parsed.reviewers).toEqual([
        "tech-debt-reviewer",
        "readme-docs-reviewer",
        "security-reviewer",
      ]);
    });

    it("leaves reviewers unset when the flag is missing", () => {
      const args = [];
      const parsed = parseArgs(args);
      expect(parsed.reviewers).toBeUndefined();
    });

    it("throws an error naming valid short names when value is missing", () => {
      const args = ["--reviewers"];
      expect(() => parseArgs(args)).toThrow();
      try {
        parseArgs(args);
      } catch (e: any) {
        expect(e.message).toContain("tech-debt");
        expect(e.message).toContain("docs");
        expect(e.message).toContain("security");
      }
    });

    it("throws an error naming valid short names when value is empty", () => {
      const args = ["--reviewers", ""];
      expect(() => parseArgs(args)).toThrow();
      try {
        parseArgs(args);
      } catch (e: any) {
        expect(e.message).toContain("tech-debt");
        expect(e.message).toContain("docs");
        expect(e.message).toContain("security");
      }
    });

    it("throws an error naming the invalid name and valid short names", () => {
      const args = ["--reviewers", "invalid-reviewer"];
      expect(() => parseArgs(args)).toThrow();
      try {
        parseArgs(args);
      } catch (e: any) {
        expect(e.message).toContain("invalid-reviewer");
        expect(e.message).toContain("tech-debt");
        expect(e.message).toContain("docs");
        expect(e.message).toContain("security");
      }
    });
  });

  describe("main()", () => {
    it("control: runs orchestrate without reviewers when no flag is provided", async () => {
      repo = makeCleanRepo();
      findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
      const code = await main([], { cwd: repo, home: fakeHome });
      expect(code).toBe(0);
      expect(orchestrateMock).toHaveBeenCalledTimes(1);
      const call = orchestrateMock.mock.calls[0]?.[0];
      expect(call?.reviewers).toBeUndefined();
    });

    it("passes the parsed reviewers list to orchestrate", async () => {
      repo = makeCleanRepo();
      findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
      await main(["--reviewers", "tech-debt,security"], { cwd: repo, home: fakeHome });
      expect(orchestrateMock).toHaveBeenCalledTimes(1);
      const call = orchestrateMock.mock.calls[0]?.[0];
      expect(call?.reviewers).toEqual(["tech-debt-reviewer", "security-reviewer"]);
    });

    it("documents the --reviewers flag in the --help text", async () => {
      await main(["--help"]);
      expect(stdoutText()).toContain("--reviewers");
    });
  });
});
```
