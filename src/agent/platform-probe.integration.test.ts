import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPolicyGuard, defaultShellAllowlist } from "../tools/policy-guard.ts";
import { toolFlavor } from "./platform-facts.ts";
import { parseProbe, probePlatform, probeScript } from "./platform-probe.ts";

/** The image swarm-verify 2.0.1 runs a node project's checks in (its verify/sandbox defaults). */
const node24 = "node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413";

describe("the platform probe, run for real", () => {
  it("reads this host's sed as the host's own: BSD on macOS, GNU on Linux", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "probe-"));
    await mkdir(join(workspace, "src"));
    await writeFile(join(workspace, "package.json"), "{}\n");
    const guard = createPolicyGuard({
      workspaceRoot: workspace,
      homeDir: homedir(),
      shellAllowlist: defaultShellAllowlist,
      deniedRoots: [],
      childHomeDir: await mkdtemp(join(tmpdir(), "probe-home-")),
    });
    const probe = await probePlatform({ workspace, env: guard.childEnvironment.variables });
    expect(probe.cut).toBe(false);
    expect(probe.layout).toEqual(["package.json", "src/"]);
    expect(toolFlavor("sed", probe.facts).flavor).toBe(
      process.platform === "darwin" ? "BSD" : "GNU",
    );
    expect(probe.facts["sed.inplace"]).toBe(process.platform === "darwin" ? "suffix" : "bare");
  });

  it("reads GNU in a Linux container", () => {
    const output = execFileSync("docker", ["run", "--rm", "-i", node24, "/bin/sh", "-s"], {
      input: probeScript,
      encoding: "utf8",
      timeout: 120_000,
    });
    const facts = parseProbe(output);
    for (const tool of ["sed", "grep", "find", "xargs"] as const) {
      expect([tool, toolFlavor(tool, facts).flavor]).toEqual([tool, "GNU"]);
    }
    expect(facts["sed.inplace"]).toBe("bare");
  });
});
