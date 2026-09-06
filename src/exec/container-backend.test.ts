import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { containerRuntimeAvailable, createContainerBackend } from "./container-backend.ts";
import { selfTestContainment } from "./execution-mode.ts";

let workspace = "";
let hostSecret = "";
let hostRoot = "";

/**
 * The self-test is only worth anything if it can come back `isolated` for something, and only
 * worth anything if it comes back `restricted` for the host. Both directions are checked; this
 * is the one that needs a runtime, so it says so rather than passing where there is none.
 */
const available = containerRuntimeAvailable("docker");

beforeEach(async () => {
  // Under the home directory rather than the system scratch directory: Docker Desktop on
  // macOS shares /Users and not /tmp, and a bind mount of an unshared path is silently empty
  // rather than an error. An empty workspace passes every escape probe, which is the reading
  // the reachability check exists to refuse.
  workspace = await mkdtemp(join(homedir(), ".swarm-container-ws-"));
  hostRoot = await mkdtemp(join(tmpdir(), "swarm-container-host-"));
  hostSecret = join(hostRoot, "host-secret.txt");
  await writeFile(hostSecret, "a value only the host should hold\n");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(hostRoot, { recursive: true, force: true });
});

describe.skipIf(!available)("a command run behind a kernel-enforced boundary", () => {
  const backend = () =>
    createContainerBackend({
      runtime: "docker",
      image: "node:24-bookworm",
      workspaceRoot: workspace,
      user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    });

  it("runs an ordinary command and returns what it wrote", async () => {
    const ran = await backend().run(["node", "-e", "process.stdout.write('ran inside')"], {
      cwd: workspace,
      timeoutMs: 120_000,
    });

    expect(ran.stdout).toContain("ran inside");
    expect(ran.exitCode).toBe(0);
  }, 180_000);

  it("refuses every escape the self-test tries, which is what isolated means", async () => {
    const result = await selfTestContainment(backend(), {
      workspaceRoot: workspace,
      hostFileOutsideWorkspace: hostSecret,
      timeoutMs: 120_000,
    });

    expect(result.probes.map((probe) => ({ id: probe.id, contained: probe.contained }))).toEqual([
      { id: "host-file-read", contained: true },
      { id: "host-file-write", contained: true },
      { id: "network-egress", contained: true },
    ]);
    expect(result.workspaceReachable).toBe(true);
    expect(result.mode).toBe("isolated");
  }, 300_000);

  it("still lets the command reach the workspace it was given", async () => {
    await writeFile(join(workspace, "present.txt"), "workspace content\n");
    const ran = await backend().run(
      ["node", "-e", "process.stdout.write(require('node:fs').readFileSync('present.txt','utf8'))"],
      { cwd: workspace, timeoutMs: 120_000 },
    );

    expect(ran.stdout).toContain("workspace content");
  }, 180_000);
});

describe.skipIf(!available)("a boundary that hides the workspace as well as the host", () => {
  /**
   * Whether a given path can be mounted is the runtime's business and differs by platform:
   * Docker Desktop on macOS shares /Users and not /tmp, and Docker on Linux shares both. So this
   * asserts the implication rather than the outcome, which is the part that must hold anywhere:
   * a backend that cannot reach its workspace is never `isolated`, whatever the escapes did.
   */
  it("is never isolated where it could not reach its own workspace", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "swarm-unshared-ws-"));
    try {
      const result = await selfTestContainment(
        createContainerBackend({
          runtime: "docker",
          image: "node:24-bookworm",
          workspaceRoot: elsewhere,
          user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        }),
        { workspaceRoot: elsewhere, hostFileOutsideWorkspace: hostSecret, timeoutMs: 120_000 },
      );

      expect(result.mode === "unknown").toBe(!result.workspaceReachable);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  }, 300_000);
});

describe("naming a runtime that is not installed", () => {
  it("reports it as unavailable rather than failing at the first run", () => {
    expect(containerRuntimeAvailable("definitely-not-a-container-runtime")).toBe(false);
  });
});
