import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ContainmentProbe,
  describeExecutionEnvelope,
  hostExecutionBackend,
  selfTestContainment,
} from "./execution-mode.ts";

let workspace = "";
let hostSecret = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-mode-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "swarm-mode-host-"));
  hostSecret = join(outside, "host-secret.txt");
  await writeFile(hostSecret, "a value only the host should hold\n");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const refused = {
  stdout: "",
  stderr: "Operation not permitted",
  exitCode: 1,
  timedOut: false,
  cancelled: false,
  truncated: false,
  startFailure: null,
};

/**
 * A kernel-enforced boundary refuses the escapes and still lets the command work in its
 * workspace. Both halves, because a backend that refuses everything is not contained, it is
 * broken, and the mode has to tell those apart.
 */
const containingBackend = {
  name: "fake-contained",
  nodeProgram: "node",
  run: (argv: readonly string[]) =>
    Promise.resolve(
      argv.join(" ").includes("swarm-reachability-probe")
        ? { ...refused, stdout: "reached", stderr: "", exitCode: 0 }
        : refused,
    ),
};

/** A mount that is silently empty: every escape refused, and the work refused with it. */
const backendThatHidesEverything = {
  name: "fake-empty-mount",
  nodeProgram: "node",
  run: () => Promise.resolve(refused),
};

describe("what the harness may claim about how a command is contained", () => {
  it("reports restricted, not isolated, when nothing kernel-enforced is in front of the command", async () => {
    const result = await selfTestContainment(hostExecutionBackend, {
      workspaceRoot: workspace,
      hostFileOutsideWorkspace: hostSecret,
    });

    expect(result.mode).toBe("restricted");
    expect(result.probes.some((probe: ContainmentProbe) => probe.contained === false)).toBe(true);
  }, 30_000);

  it("names which probe got out, rather than reporting a bare verdict", async () => {
    const result = await selfTestContainment(hostExecutionBackend, {
      workspaceRoot: workspace,
      hostFileOutsideWorkspace: hostSecret,
    });

    const hostRead = result.probes.find((probe) => probe.id === "host-file-read");
    expect(hostRead?.contained).toBe(false);
    expect(hostRead?.observed).toContain("a value only the host should hold");
  }, 30_000);

  it("reports isolated only where every probe was refused", async () => {
    const result = await selfTestContainment(containingBackend, {
      workspaceRoot: workspace,
      hostFileOutsideWorkspace: hostSecret,
    });

    expect(result.mode).toBe("isolated");
    expect(result.workspaceReachable).toBe(true);
    expect(result.probes.every((probe) => probe.contained)).toBe(true);
  });

  it("is unknown where the boundary hid the workspace too, not isolated", async () => {
    // Every escape refused, and the work refused with it. A command that can see nothing is
    // contained and cannot do anything, so this is a broken mount rather than containment, and
    // reading it as isolation would be a pass earned by the work being impossible.
    const result = await selfTestContainment(backendThatHidesEverything, {
      workspaceRoot: workspace,
      hostFileOutsideWorkspace: hostSecret,
    });

    expect(result.workspaceReachable).toBe(false);
    expect(result.mode).toBe("unknown");
    expect(result.summary).toMatch(/could not reach the workspace/i);
  });

  it("describes the envelope a run executes under rather than leaving it to be inferred", async () => {
    const selfTest = await selfTestContainment(hostExecutionBackend, {
      workspaceRoot: workspace,
      hostFileOutsideWorkspace: hostSecret,
    });
    const envelope = describeExecutionEnvelope({
      selfTest,
      workspaceRoot: workspace,
      withheldEnvironmentNames: ["ANTHROPIC_API_KEY", "AWS_SECRET_ACCESS_KEY"],
      repositoryConfigTrusted: false,
    });

    expect(envelope.mode).toBe("restricted");
    expect(envelope.backend).toBe("host");
    expect(envelope.writablePaths).toContain(workspace);
    expect(envelope.credentialNamesWithheld).toBe(2);
    expect(envelope.network).toBe("unrestricted");
    expect(envelope.repositoryConfigTrusted).toBe(false);
  }, 30_000);

  it("says in one line what the mode does and does not establish", async () => {
    const selfTest = await selfTestContainment(hostExecutionBackend, {
      workspaceRoot: workspace,
      hostFileOutsideWorkspace: hostSecret,
    });

    expect(selfTest.summary).toMatch(/not a sandbox|no kernel-enforced/i);
  }, 30_000);
});
