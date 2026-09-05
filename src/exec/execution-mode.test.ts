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

/** A backend that refuses every probe, standing in for a kernel-enforced boundary. */
const containingBackend = {
  name: "fake-contained",
  run: () =>
    Promise.resolve({
      stdout: "",
      stderr: "Operation not permitted",
      exitCode: 1,
      timedOut: false,
      cancelled: false,
      truncated: false,
      startFailure: null,
    }),
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
    expect(result.probes.every((probe) => probe.contained)).toBe(true);
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
