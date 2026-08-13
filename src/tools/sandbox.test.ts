import { describe, expect, it } from "vitest";
import { createSandbox, type SandboxPolicy } from "./sandbox.ts";

const policy: SandboxPolicy = {
  workspaceRoot: "/work/repo",
  homeDir: "/home/dev",
  shellAllowlist: ["git", "npm"],
  deniedRoots: ["/home/dev/.swarm"],
  // No real filesystem in these tests: every path resolves to itself.
  realpath: (path) => path,
};

const sandbox = createSandbox(policy);

describe("sandbox path containment", () => {
  it("resolves workspace-relative paths", () => {
    expect(sandbox.checkPath("src/core/loop.ts")).toEqual({
      allowed: true,
      absolutePath: "/work/repo/src/core/loop.ts",
    });
  });

  it("accepts an absolute path that stays inside the workspace", () => {
    expect(sandbox.checkPath("/work/repo/package.json")).toEqual({
      allowed: true,
      absolutePath: "/work/repo/package.json",
    });
  });

  it("refuses a traversal that climbs out of the workspace", () => {
    const verdict = sandbox.checkPath("../../etc/passwd");
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toContain("outside the workspace");
  });

  it("refuses an absolute path outside the workspace", () => {
    expect(sandbox.checkPath("/etc/passwd").allowed).toBe(false);
  });

  it("refuses a sibling directory sharing the workspace name prefix", () => {
    expect(sandbox.checkPath("/work/repo-backup/secrets.txt").allowed).toBe(false);
  });

  it("refuses a symlink that resolves outside the workspace", () => {
    const linked = createSandbox({
      ...policy,
      realpath: (path) => path.replace("/work/repo/link", "/elsewhere/target"),
    });
    expect(linked.checkPath("link/file.ts").allowed).toBe(false);
  });

  it("checks a file that does not exist yet through its nearest existing parent", () => {
    // A real realpath throws on a missing path, so the check walks up to what exists.
    const existing = new Set(["/work/repo", "/work/repo/src", "/work/repo/link"]);
    const partial = createSandbox({
      ...policy,
      realpath: (path) => {
        if (!existing.has(path)) {
          throw new Error(`ENOENT ${path}`);
        }
        return path === "/work/repo/link" ? "/elsewhere/target" : path;
      },
    });

    expect(partial.checkPath("src/new-file.ts")).toEqual({
      allowed: true,
      absolutePath: "/work/repo/src/new-file.ts",
    });
    expect(partial.checkPath("link/new-file.ts").allowed).toBe(false);
  });

  it("refuses an empty path", () => {
    expect(sandbox.checkPath("   ").allowed).toBe(false);
  });

  it("refuses the session store even though it sits outside the workspace check order", () => {
    const verdict = createSandbox({ ...policy, workspaceRoot: "/home/dev" }).checkPath(
      ".swarm/sessions/abc/ledger.jsonl",
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toContain("denied path");
  });
});

describe("sandbox credential denylist", () => {
  const denied = [
    ".env",
    ".env.local",
    "config/.env.production",
    "certs/server.pem",
    "certs/server.key",
    ".git/config",
    // The rule is the documented glob `.env*`, so a template file is refused too.
    ".env.example",
  ];

  for (const path of denied) {
    it(`refuses ${path}`, () => {
      const verdict = sandbox.checkPath(path);
      expect(verdict.allowed).toBe(false);
      expect(verdict.allowed === false && verdict.reason).toContain("credential denylist");
    });
  }

  it("refuses credential paths reached through a traversal that lands back inside", () => {
    expect(sandbox.checkPath("src/../.env").allowed).toBe(false);
  });

  const allowed = ["src/environment.ts", "docs/keys.md", ".github/config.yml", "src/env/index.ts"];
  for (const path of allowed) {
    it(`allows ${path}`, () => {
      expect(sandbox.checkPath(path).allowed).toBe(true);
    });
  }
});

describe("sandbox shell allowlist", () => {
  it("allows a command whose executable is listed", () => {
    expect(sandbox.isCommandAllowed("git status")).toBe(true);
    expect(sandbox.isCommandAllowed("  npm   run gates ")).toBe(true);
  });

  it("refuses anything else, leaving the confirmation fallback to decide", () => {
    expect(sandbox.isCommandAllowed("curl https://example.com")).toBe(false);
    expect(sandbox.isCommandAllowed("")).toBe(false);
  });
});
