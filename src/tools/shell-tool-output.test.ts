import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSandbox, defaultShellAllowlist } from "./sandbox.ts";
import { createShellTool } from "./shell-tool.ts";
import type { ToolOutput } from "./tool-definition.ts";

/**
 * What a shell call reports once the chokepoint has let it through.
 *
 * `shell-tool.test.ts` beside this one covers what the call is allowed to reach; this covers
 * what comes back from one that ran. The facts are the part that matters downstream: a gate
 * result or a claim rests on the exit code the harness measured, never on the text the model
 * was shown, so every case here reads the facts rather than the prose.
 */

let workspace = "";
let home = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-shell-output-"));
  home = await mkdtemp(join(tmpdir(), "swarm-shell-output-home-"));
  await writeFile(join(workspace, "greeting.txt"), "hello\n");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

function run(input: Record<string, unknown>): Promise<ToolOutput> {
  const sandbox = createSandbox({
    workspaceRoot: workspace,
    homeDir: home,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [],
  });
  return createShellTool(sandbox).execute(input);
}

describe("what a shell call reports about a command that succeeded", () => {
  it("carries the exit code as a fact rather than only in the text", async () => {
    const output = await run({ command: "printf ok" });

    expect(output.facts).toMatchObject({ command: "printf ok", exitCode: 0, timedOut: false });
    expect(output.text).toContain("exit code: 0");
    expect(output.text).toContain("stdout:\nok");
  });

  it("measures the bytes each stream produced", async () => {
    const output = await run({ command: "printf abc; printf de >&2" });

    expect(output.facts).toMatchObject({ stdoutBytes: 3, stderrBytes: 2 });
  });

  it("leaves out a stream that produced nothing, rather than printing an empty section", async () => {
    const output = await run({ command: "true" });

    expect(output.text).toBe("exit code: 0");
  });

  it("runs from the workspace root, so a relative path means what it says", async () => {
    const output = await run({ command: "cat greeting.txt" });

    expect(output.text).toContain("hello");
    expect(output.facts?.exitCode).toBe(0);
  });
});

describe("what a shell call reports about a command that failed", () => {
  it("returns the failure as output rather than throwing, with the code measured", async () => {
    const output = await run({ command: "exit 3" });

    expect(output.facts).toMatchObject({ exitCode: 3, timedOut: false });
    expect(output.text).toContain("exit code: 3");
  });

  it("keeps what a failing command managed to print", async () => {
    const output = await run({ command: "printf partial; printf boom >&2; exit 1" });

    expect(output.facts).toMatchObject({ exitCode: 1, stdoutBytes: 7, stderrBytes: 4 });
    expect(output.text).toContain("stdout:\npartial");
    expect(output.text).toContain("stderr:\nboom");
  });

  it("says a command was killed for running too long, and says so as a fact", async () => {
    // A timeout and a non-zero exit are different findings: one measured the command, the
    // other measured how long it was given.
    const output = await run({ command: "sleep 5", timeoutMs: 150 });

    expect(output.facts?.timedOut).toBe(true);
    expect(output.text).toContain("killed for exceeding its timeout");
  });

  it("reports a command that does not exist as a failure of that command", async () => {
    const output = await run({ command: "definitely-not-a-real-program" });

    expect(output.facts?.exitCode).not.toBe(0);
    expect(output.facts?.timedOut).toBe(false);
  });
});

describe("what a shell call declares it would touch", () => {
  it("names the words the command could open, so the sandbox rules before it runs", () => {
    const sandbox = createSandbox({
      workspaceRoot: workspace,
      homeDir: home,
      shellAllowlist: defaultShellAllowlist,
      deniedRoots: [],
    });

    expect(createShellTool(sandbox).pathsFrom({ command: "cat greeting.txt" })).toContain(
      "greeting.txt",
    );
  });

  it("declares nothing for a command whose effect a shell decides, so it is confirmed instead", () => {
    const sandbox = createSandbox({
      workspaceRoot: workspace,
      homeDir: home,
      shellAllowlist: defaultShellAllowlist,
      deniedRoots: [],
    });

    // A substitution names no path this reader can rule on. Declaring none is what routes the
    // call to a person rather than guessing at what it would open.
    expect(createShellTool(sandbox).pathsFrom({ command: "cat $(find . -name '*.key')" })).toEqual(
      [],
    );
  });
});
