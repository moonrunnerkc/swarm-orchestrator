import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSandbox } from "./sandbox.ts";
import { createShellTool } from "./shell-tool.ts";

/**
 * What a shell run reports, and what it carries as a fact.
 *
 * The chokepoint in front of this tool is tested next door, on what it refuses. This is the
 * other half: a command that was allowed to run, and what the harness observed of it. The exit
 * code is the load-bearing part, because a gate result or a claim about a test run has to rest
 * on something the harness measured rather than on text the model was shown.
 */

let workspace = "";
let home = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-shell-out-workspace-"));
  home = await mkdtemp(join(tmpdir(), "swarm-shell-out-home-"));
  await writeFile(join(workspace, "hello.txt"), "hello\n");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

/** Straight to the tool: what the chokepoint would refuse is not what is being measured here. */
function shell() {
  return createShellTool(
    createSandbox({
      workspaceRoot: workspace,
      homeDir: home,
      shellAllowlist: [],
      deniedRoots: [],
    }),
  );
}

describe("a command that succeeded", () => {
  it("reports exit code zero and carries it as a fact", async () => {
    const outcome = await shell().execute({ command: "cat hello.txt" });

    expect(outcome.text).toContain("exit code: 0");
    expect(outcome.facts).toMatchObject({ command: "cat hello.txt", exitCode: 0, timedOut: false });
  });

  it("shows what the command printed, with the trailing newline trimmed", async () => {
    const outcome = await shell().execute({ command: "cat hello.txt" });

    expect(outcome.text).toContain("stdout:\nhello");
    expect(outcome.text).not.toContain("hello\n\n");
  });

  it("counts the bytes of each stream, which the text alone does not say", async () => {
    const outcome = await shell().execute({ command: "cat hello.txt" });

    expect(outcome.facts).toMatchObject({ stdoutBytes: 6, stderrBytes: 0 });
  });

  it("runs from the workspace root, whatever the process cwd is", async () => {
    const outcome = await shell().execute({ command: "pwd" });

    expect(outcome.text).toContain(workspace.replace(/^\/private/, ""));
  });

  it("mentions neither stream when the command printed nothing", async () => {
    const outcome = await shell().execute({ command: "true" });

    expect(outcome.text).toBe("exit code: 0");
  });
});

describe("a command that failed", () => {
  it("reports the exit code the command chose, rather than a generic failure", async () => {
    const outcome = await shell().execute({ command: "exit 3" });

    expect(outcome.text).toContain("exit code: 3");
    expect(outcome.facts).toMatchObject({ exitCode: 3, timedOut: false });
  });

  it("keeps what the command wrote to stderr", async () => {
    const outcome = await shell().execute({ command: "cat no-such-file" });

    expect(outcome.text).toContain("stderr:");
    expect(outcome.facts?.exitCode).not.toBe(0);
    expect(Number(outcome.facts?.stderrBytes)).toBeGreaterThan(0);
  });

  it("keeps output the command produced before it failed", async () => {
    const outcome = await shell().execute({ command: "cat hello.txt; exit 4" });

    expect(outcome.text).toContain("stdout:\nhello");
    expect(outcome.facts).toMatchObject({ exitCode: 4 });
  });
});

describe("a command that outlived its timeout", () => {
  it("says it was killed, and says so as a fact rather than only in the text", async () => {
    // A run that was killed and a run that failed on its own are two different findings, and
    // a caller reading only the exit code cannot tell them apart.
    const outcome = await shell().execute({ command: "sleep 5", timeoutMs: 150 });

    expect(outcome.text).toContain("killed for exceeding its timeout");
    expect(outcome.facts).toMatchObject({ timedOut: true });
  }, 20_000);
});
