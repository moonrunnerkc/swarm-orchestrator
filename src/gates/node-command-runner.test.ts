import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { childEnvironment } from "../exec/child-environment.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-gate-runner-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function runner() {
  return createNodeCommandRunner(
    { now: () => 0, sleep: () => Promise.resolve() },
    childEnvironment(process.env, { homeDir: join(workspace, "child-home") }),
  );
}

const options = { cwd: "", timeoutMs: 30_000 };

describe("what a repository-declared gate command inherits", () => {
  it("does not hand a gate the project declared the provider key the harness holds", async () => {
    // A gate command is text the repository wrote. It runs through a shell, so it reads the
    // environment, and a repository that names `node -e ...` as its lint gate used to be handed
    // every key the operator's shell held.
    process.env.ANTHROPIC_API_KEY = "sk-ant-decoy-value-for-this-test";
    try {
      const observed = await runner().run(
        "node -e \"process.stdout.write(process.env.ANTHROPIC_API_KEY ?? 'absent')\"",
        { ...options, cwd: workspace },
      );

      expect(observed.stdout).not.toContain("sk-ant-decoy-value-for-this-test");
      expect(observed.stdout).toContain("absent");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("still runs an ordinary declared command", async () => {
    const observed = await runner().run("node -e \"process.stdout.write('ran')\"", {
      ...options,
      cwd: workspace,
    });

    expect(observed.exitCode).toBe(0);
    expect(observed.stdout).toContain("ran");
  });

  it("does not hand a vouched vector the provider key either", async () => {
    process.env.OPENAI_API_KEY = "sk-oai-decoy-value-for-this-test";
    try {
      const observed = await runner().runVouched(
        [process.execPath, "-e", "process.stdout.write(process.env.OPENAI_API_KEY ?? 'absent')"],
        { ...options, cwd: workspace },
      );

      expect(observed.stdout).not.toContain("sk-oai-decoy-value-for-this-test");
      expect(observed.stdout).toContain("absent");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});
