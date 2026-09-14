import { networkInterfaces } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlledNetworkTarget } from "./controlled-network.ts";
import { describeExecutionEnvelope, selfTestContainment } from "./execution-mode.ts";

vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  networkInterfaces: vi.fn(),
}));

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
