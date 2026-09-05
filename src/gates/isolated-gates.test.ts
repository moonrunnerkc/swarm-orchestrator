import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { containerRuntimeAvailable, createContainerBackend } from "../exec/container-backend.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

const available = containerRuntimeAvailable("docker");

let workspace = "";
let hostRoot = "";
let hostSecret = "";

beforeEach(async () => {
  // Docker Desktop on macOS shares /Users and not /tmp.
  workspace = await mkdtemp(join(homedir(), ".swarm-isolated-gate-"));
  hostRoot = await mkdtemp(join(tmpdir(), "swarm-isolated-gate-host-"));
  hostSecret = join(hostRoot, "host-secret.txt");
  await writeFile(hostSecret, "a value only the host should hold\n");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(hostRoot, { recursive: true, force: true });
});

const clock = { now: () => 0, sleep: () => Promise.resolve() };

const backend = () =>
  createContainerBackend({
    runtime: "docker",
    image: "node:24-bookworm",
    workspaceRoot: workspace,
    user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
  });

describe.skipIf(!available)("a gate command run behind a boundary", () => {
  it("runs the project's declared command and reports what it exited with", async () => {
    const runner = createNodeCommandRunner(clock, harnessChildEnvironment(), backend());

    const observed = await runner.run("node -e \"process.stdout.write('gate ran')\"", {
      cwd: workspace,
      timeoutMs: 120_000,
    });

    expect(observed.exitCode).toBe(0);
    expect(observed.stdout).toContain("gate ran");
  }, 180_000);

  it("cannot read a host file, which a declared gate command on the host can", async () => {
    // A gate command is text the repository wrote. On the host it reaches whatever it names.
    const isolated = createNodeCommandRunner(clock, harnessChildEnvironment(), backend());
    const onHost = createNodeCommandRunner(clock, harnessChildEnvironment());

    const behind = await isolated.run(
      `node -e "process.stdout.write(require('fs').readFileSync('${hostSecret}','utf8'))"`,
      {
        cwd: workspace,
        timeoutMs: 120_000,
      },
    );
    const loose = await onHost.run(
      `node -e "process.stdout.write(require('fs').readFileSync('${hostSecret}','utf8'))"`,
      {
        cwd: workspace,
        timeoutMs: 120_000,
      },
    );

    expect(behind.stdout).not.toContain("a value only the host should hold");
    expect(loose.stdout).toContain("a value only the host should hold");
  }, 180_000);

  it("still runs a vouched vector behind the boundary", async () => {
    const runner = createNodeCommandRunner(clock, harnessChildEnvironment(), backend());

    const observed = await runner.runVouched(
      ["node", "-e", "process.stdout.write('vouched ran')"],
      { cwd: workspace, timeoutMs: 120_000 },
    );

    expect(observed.stdout).toContain("vouched ran");
  }, 180_000);
});
