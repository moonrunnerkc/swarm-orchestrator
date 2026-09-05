import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { containerRuntimeAvailable, createContainerBackend } from "../exec/container-backend.ts";
import { createPolicyGuard, defaultShellAllowlist } from "./policy-guard.ts";
import { createShellTool } from "./shell-tool.ts";

const available = containerRuntimeAvailable("docker");

let workspace = "";
let hostRoot = "";
let hostSecret = "";

beforeEach(async () => {
  // Under the home directory: Docker Desktop on macOS shares /Users and not /tmp.
  workspace = await mkdtemp(join(homedir(), ".swarm-isolated-ws-"));
  hostRoot = await mkdtemp(join(tmpdir(), "swarm-isolated-host-"));
  hostSecret = join(hostRoot, "host-secret.txt");
  await writeFile(hostSecret, "a value only the host should hold\n");
  await writeFile(join(workspace, "package.json"), '{"name":"w"}\n');
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(hostRoot, { recursive: true, force: true });
});

function shellOn(backend?: ReturnType<typeof createContainerBackend>) {
  const guard = createPolicyGuard({
    workspaceRoot: workspace,
    homeDir: hostRoot,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [],
  });
  const tool = createShellTool(guard, backend === undefined ? undefined : { backend });
  return (command: string) => tool.execute({ command });
}

const containerBackend = () =>
  createContainerBackend({
    runtime: "docker",
    image: "node:24-bookworm",
    workspaceRoot: workspace,
    user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
  });

describe.skipIf(!available)("a shell command run behind a kernel-enforced boundary", () => {
  it("runs the command and returns what it wrote", async () => {
    const output = await shellOn(containerBackend())("cat package.json");

    expect(output.text).toContain("exit code: 0");
    expect(output.text).toContain('"name":"w"');
  }, 180_000);

  it("cannot read a host file the lexical policy would also have refused", async () => {
    // The policy guard refuses this by reading the path out of the command. The point here is
    // the layer under that one: even where the reader is bypassed, the file is not there.
    const output = await shellOn(containerBackend())(`cat ${hostSecret}`);

    expect(output.text).not.toContain("a value only the host should hold");
  }, 180_000);

  it("cannot reach a host path through an expansion no reader rules on", async () => {
    // A substitution is exactly the case the lexical reader declines to read, and where a
    // person answering yes is the whole of the protection today.
    const output = await shellOn(containerBackend())(`cat $(echo ${hostSecret})`);

    expect(output.text).not.toContain("a value only the host should hold");
  }, 180_000);
});

describe("the same command with no backend in front of it", () => {
  it("reaches the host file, which is what restricted means", async () => {
    const output = await shellOn()(`cat ${hostSecret}`);

    expect(output.text).toContain("a value only the host should hold");
  }, 60_000);
});
