import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * What a run needs is checked before the session opens and before the model is asked for
 * anything. The failure this covers was found by running the tool: a task in a directory that
 * was not a repository ran eight steps and 28,000 tokens, wrote the files, and then failed at
 * the first gate with the message that should have been the first line printed.
 */
let scratch = "";

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-preflight-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function swarm(args: readonly string[], cwd: string) {
  try {
    const ran = await run(process.execPath, [resolve("src/cli.ts"), ...args], {
      cwd,
      // No key and no backend: the check under test has to come before either is needed.
      env: { PATH: process.env.PATH ?? "", HOME: join(scratch, "home"), NO_COLOR: "1" },
      timeout: 60_000,
    });
    return { code: 0, output: `${ran.stdout}${ran.stderr}` };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

async function sessionsWritten(): Promise<readonly string[]> {
  try {
    return await readdir(join(scratch, "home", ".swarm", "sessions"));
  } catch {
    return [];
  }
}

describe("a task in a directory that is not a repository", () => {
  it("stops with the remedy named before a session is opened or a model is needed", async () => {
    const workspace = join(scratch, "plain");
    await run("mkdir", [workspace]);

    const ran = await swarm(["--workspace", workspace, "create a calculator"], workspace);

    expect(ran.code).not.toBe(0);
    expect(ran.output).toContain("not a git working tree");
    expect(ran.output).toContain("git init");
    expect(ran.output).not.toMatch(/API key|model/i);
    expect(await sessionsWritten()).toEqual([]);
  });

  it("stops the same way for a base ref the repository does not have", async () => {
    const workspace = join(scratch, "repo");
    await run("git", ["init", "-q", workspace]);
    await run(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "base",
      ],
      { cwd: workspace },
    );

    const ran = await swarm(
      ["--workspace", workspace, "--base", "no-such-ref", "create a calculator"],
      workspace,
    );

    expect(ran.code).not.toBe(0);
    expect(ran.output).toContain("pass a base ref that exists");
    expect(await sessionsWritten()).toEqual([]);
  });
});
