import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlledNetworkTarget } from "./controlled-network.ts";
import { describeExecutionEnvelope, selfTestContainment } from "./execution-mode.ts";

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  networkInterfaces: vi.fn(),
}));

const actualInterfaces = (await vi.importActual<typeof import("node:os")>("node:os"))
  .networkInterfaces;

afterEach(() => vi.resetAllMocks());

describe("unavailable controlled network observations", () => {
  it("returns unavailable when interface enumeration throws", async () => {
    vi.mocked(networkInterfaces).mockImplementation(() => {
      throw new Error("uv_interface_addresses returned Unknown system error 1");
    });
    await expect(controlledNetworkTarget()).resolves.toBeNull();
  });

  it("returns unavailable when no non-loopback address exists", async () => {
    vi.mocked(networkInterfaces).mockReturnValue({});
    await expect(controlledNetworkTarget()).resolves.toBeNull();
  });

  it("cannot turn an unavailable probe into network denial or isolation", async () => {
    vi.mocked(networkInterfaces).mockImplementation(() => {
      throw new Error("interface enumeration unavailable");
    });
    const observation = await selfTestContainment(
      {
        name: "refuses-escapes",
        nodeProgram: "node",
        run: async (argv) => ({
          stdout: argv.join(" ").includes("swarm-reachability-probe") ? "reached" : "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          truncated: false,
          startFailure: null,
        }),
      },
      { workspaceRoot: "/unused-workspace", hostFileOutsideWorkspace: "/unused-host-decoy" },
    );
    expect(observation.workspaceReachable).toBe(true);
    expect(observation.mode).toBe("unknown");
    expect(observation.probes.find((probe) => probe.id === "network-egress")).toMatchObject({
      contained: null,
      observed: expect.stringContaining("unknown"),
    });
    expect(
      describeExecutionEnvelope({
        selfTest: observation,
        workspaceRoot: "/unused-workspace",
        withheldEnvironmentNames: [],
        repositoryConfigTrusted: false,
      }).network,
    ).toBe("unknown");
  });
});

describe("the shell form of the network probe", () => {
  /**
   * An image built for a Python project carries no node, so the probe falls back through
   * python3 and bash. Each fallback is run here against the live target, on the host, by
   * forcing the branch: a fallback that could never connect would make every such image look
   * network-contained for free. The runs are asynchronous, since the target's listener lives
   * on this same event loop.
   */
  it("connects through python3 and through bash, and names the case where no program exists", async () => {
    vi.mocked(networkInterfaces).mockImplementation(() => actualInterfaces());
    const target = await controlledNetworkTarget();
    if (target === null) return;
    const sh = (script: string) =>
      new Promise<{ stdout: string; stderr: string; status: number | null }>((resolve) => {
        execFile(
          "sh",
          ["-c", script],
          { encoding: "utf8", timeout: 10_000 },
          (error, stdout, stderr) =>
            resolve({
              stdout,
              stderr,
              status: error === null ? 0 : ((error as { code?: number }).code ?? null),
            }),
        );
      });
    try {
      const withoutNode = target.shellScript.replace("command -v node", "false");
      expect((await sh(withoutNode)).stdout).toBe("connected");
      const withoutNodeOrPython = withoutNode.replace("command -v python3", "false");
      expect((await sh(withoutNodeOrPython)).stdout).toBe("connected");
      const none = await sh(withoutNodeOrPython.replace("command -v bash", "false"));
      expect(none.status).toBe(78);
      expect(none.stderr).toContain("no program in this image can attempt the connection");
    } finally {
      await target.close();
    }
  });
});
