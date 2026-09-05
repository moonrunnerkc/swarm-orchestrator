import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolInvocation } from "../core/tool-invoker.ts";
import { createToolChokepoint } from "./chokepoint.ts";
import type { ChokepointRecord, ChokepointRecorder } from "./chokepoint-record.ts";
import { createDerivationHeuristic } from "./derivation.ts";
import { createPolicyGuard, defaultShellAllowlist } from "./policy-guard.ts";
import { createShellTool } from "./shell-tool.ts";

/**
 * A real workspace and a stand-in home directory holding a stand-in secret, so a regression
 * here reads the decoy rather than the machine's own key.
 */
let workspace = "";
let home = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-shell-workspace-"));
  home = await mkdtemp(join(tmpdir(), "swarm-shell-home-"));
  await writeFile(join(workspace, "package.json"), '{"name":"x"}\n');
  await writeFile(join(workspace, ".env"), "API_KEY=not-a-real-key\n");
  await writeFile(join(home, "decoy-private-key"), "not-a-real-key\n");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

function run(command: string, timeoutMs?: number) {
  const settled: ChokepointRecord[] = [];
  const recorder: ChokepointRecorder = {
    recordCall(entry) {
      settled.push(entry);
      return Promise.resolve(`sha256:${"ab".repeat(32)}`);
    },
    recordConfirmation: () => Promise.resolve(),
  };
  const guard = createPolicyGuard({
    workspaceRoot: workspace,
    homeDir: home,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [],
  });
  const chokepoint = createToolChokepoint({
    definitions: [createShellTool(guard)],
    guard,
    derivation: createDerivationHeuristic(),
    // Nothing here may be rescued by a person saying yes: the guard rules before the ask.
    confirm: () => Promise.resolve(true),
    recorder,
  });
  const invocation: ToolInvocation = {
    callId: "call-1",
    toolName: "shell",
    input: timeoutMs === undefined ? { command } : { command, timeoutMs },
    provenance: "model",
  };
  return chokepoint.invoke(invocation).then((call) => ({
    output: call.output,
    outcome: settled.find((entry) => entry.decision !== "requested"),
  }));
}

describe("what a shell command is allowed to touch", () => {
  it("denies a credential read the command would have made", async () => {
    // `cat` is on the allowlist, so before the command declared its paths this ran and returned
    // the file. The denial has to come from the guard rather than from the allowlist.
    const { outcome } = await run("cat ~/decoy-private-key");

    expect(outcome?.decision).toBe("denied");
    expect(outcome?.denial).toBe("guard");
    expect(outcome?.detail).toContain("outside the workspace");
  });

  it("denies a workspace credential file by the same denylist the read tool answers to", async () => {
    const { outcome } = await run("cat .env");

    expect(outcome?.decision).toBe("denied");
    expect(outcome?.denial).toBe("guard");
    expect(outcome?.detail).toContain("credential denylist");
  });

  it("denies a climb out of the workspace", async () => {
    const { outcome } = await run("cat ../../etc/passwd");

    expect(outcome?.decision).toBe("denied");
    expect(outcome?.denial).toBe("guard");
  });

  it("denies a redirect that would write outside the workspace", async () => {
    const { outcome } = await run("cat package.json > ~/decoy-private-key");

    expect(outcome?.decision).toBe("denied");
    expect(outcome?.denial).toBe("guard");
  });

  it("still runs an ordinary command against a workspace file", async () => {
    const { output, outcome } = await run("cat package.json");

    expect(outcome?.decision).toBe("allowed");
    expect(output).toContain("exit code: 0");
    expect(output).toContain('"name":"x"');
  });
});

describe("what a shell command inherits from the process that started the run", () => {
  it("does not hand the model's command the provider key the harness was started with", async () => {
    // No path check can see this read: `process.env.ANTHROPIC_API_KEY` names no file. The only
    // thing standing between a command the model wrote and the operator's own key is the
    // environment the child is given.
    process.env.ANTHROPIC_API_KEY = "sk-ant-decoy-value-for-this-test";
    try {
      const { output } = await run(
        "node -e \"process.stdout.write(process.env.ANTHROPIC_API_KEY ?? 'absent')\"",
      );

      expect(output).not.toContain("sk-ant-decoy-value-for-this-test");
      expect(output).toContain("absent");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("does not hand it an unrecognized name from the operator's shell either", async () => {
    process.env.SWARM_TEST_INTERNAL_ENDPOINT = "https://internal.example";
    try {
      const { output } = await run(
        "node -e \"process.stdout.write(process.env.SWARM_TEST_INTERNAL_ENDPOINT ?? 'absent')\"",
      );

      expect(output).not.toContain("internal.example");
      expect(output).toContain("absent");
    } finally {
      delete process.env.SWARM_TEST_INTERNAL_ENDPOINT;
    }
  });

  it("still gives the command a PATH, so an ordinary toolchain runs", async () => {
    const { output } = await run("node -e \"process.stdout.write('ran')\"");

    expect(output).toContain("exit code: 0");
    expect(output).toContain("ran");
  });
});

describe("what is left running after a command is stopped", () => {
  /**
   * The timeout kills the process the harness started. Anything that process started is in the
   * same session but out of reach, so a command whose child outlives it leaves that child
   * writing to the workspace after the run has moved on. Nothing measures what it writes, and
   * what it writes lands in the diff a gate reads.
   */
  it("kills what the command started, not only the command", async () => {
    await writeFile(
      join(workspace, "child.mjs"),
      "import { writeFileSync } from 'node:fs';\n" +
        "setTimeout(() => writeFileSync('orphan.txt', 'written'), 900);\n",
    );
    await writeFile(
      join(workspace, "parent.mjs"),
      "import { spawn } from 'node:child_process';\n" +
        "spawn(process.execPath, ['child.mjs'], { stdio: 'ignore' });\n" +
        "setTimeout(() => {}, 20000);\n",
    );

    const { output } = await run("node parent.mjs", 300);
    expect(output).toContain("timeout");

    await new Promise((settle) => setTimeout(settle, 2_500));

    expect(existsSync(join(workspace, "orphan.txt"))).toBe(false);
  }, 20_000);
});
