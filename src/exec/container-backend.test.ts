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

it("owns cleanup after a successful parent exit", async () => {
  const commands: readonly string[][] = [];
  const captured = commands as string[][];
  const phases: string[] = [];
  const backend = createContainerBackend({
    runtime: "test-runtime",
    image: "test-image",
    workspaceRoot: workspace,
    user: "1000:1000",
    observeLifecycle: async (event) => {
      phases.push(event.phase);
    },
    runProcess: async (_program, args) => {
      captured.push([...args]);
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        truncated: false,
        startFailure: null,
      };
    },
  });
  await backend.run(["node", "parent.mjs"], { cwd: workspace, timeoutMs: 1000 });
  expect(captured.map((args) => args[0])).toEqual(["create", "start", "rm", "ps"]);
  expect(phases).toEqual(["created", "removed"]);
  expect(captured[0]?.some((arg) => arg.startsWith("--name=swarm-"))).toBe(true);
});

it.skipIf(!available)(
  "removes a detached descendant after its parent exits successfully",
  async () => {
    const { readFile } = await import("node:fs/promises");
    const { runProcessGroup } = await import("./run-process.ts");
    const phases: { identity: string; phase: string }[] = [];
    const backend = createContainerBackend({
      runtime: "docker",
      image: "node:24-bookworm",
      workspaceRoot: workspace,
      user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      observeLifecycle: async (event) => {
        phases.push(event);
      },
    });
    const child =
      "const fs=require('node:fs');setInterval(()=>fs.appendFileSync('/workspace/canary','x'),20);process.on('SIGTERM',()=>{});";
    const parent = `const {spawn}=require('node:child_process');spawn('node',['-e',${JSON.stringify(child)}],{detached:true,stdio:'ignore'}).unref();setTimeout(()=>process.exit(0),300);`;
    const ran = await backend.run(["node", "-e", parent], { cwd: workspace, timeoutMs: 30_000 });
    expect(ran.exitCode).toBe(0);
    const before = await readFile(join(workspace, "canary"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await readFile(join(workspace, "canary"), "utf8")).toBe(before);
    const identity = phases[0]?.identity ?? "missing-runtime-identity";
    const inspected = await runProcessGroup(
      "docker",
      ["ps", "--all", "--quiet", "--filter", `name=^/${identity}$`],
      {
        cwd: workspace,
        env: { PATH: process.env.PATH ?? "", HOME: homedir() },
        timeoutMs: 10_000,
        maxOutputBytes: 1000,
      },
    );
    expect(inspected.stdout.trim()).toBe("");
    expect(phases.at(-1)?.phase).toBe("removed");
  },
  60_000,
);

it.skipIf(!available).each(["timeout", "cancel"] as const)(
  "removes detached descendants after %s",
  async (mode) => {
    const { readFile } = await import("node:fs/promises");
    const abort = new AbortController();
    const phases: string[] = [];
    const backend = createContainerBackend({
      runtime: "docker",
      image: "node:24-bookworm",
      workspaceRoot: workspace,
      user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      observeLifecycle: async (event) => {
        phases.push(event.phase);
      },
    });
    const descendant =
      "const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync('/workspace/late-canary','x'),20);";
    const parent = `require('node:child_process').spawn('node',['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'}).unref();process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
    const executing = backend.run(["node", "-e", parent], {
      cwd: workspace,
      timeoutMs: mode === "timeout" ? 2000 : 10000,
      signal: abort.signal,
    });
    if (mode === "cancel") {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        if (await readFile(join(workspace, "late-canary"), "utf8").catch(() => "")) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      abort.abort();
    }
    const observed = await executing;
    expect(mode === "cancel" ? observed.cancelled : observed.timedOut).toBe(true);
    const before = await readFile(join(workspace, "late-canary"), "utf8");
    expect(before.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await readFile(join(workspace, "late-canary"), "utf8")).toBe(before);
    expect(phases.at(-1)).toBe("removed");
  },
  30000,
);

it.skipIf(!available)(
  "repairs the owned runtime after abrupt harness death",
  async () => {
    const { spawn } = await import("node:child_process");
    const { readFile } = await import("node:fs/promises");
    const { repairRuntimeResources } = await import("./runtime-resource.ts");
    const { pathToFileURL } = await import("node:url");
    const { resolve } = await import("node:path");
    const program = join(hostRoot, "harness.mjs");
    const evidenceModule = pathToFileURL(resolve("src/evidence/session.ts")).href;
    const backendModule = pathToFileURL(resolve("src/exec/runtime-resource.ts")).href;
    await writeFile(
      program,
      `import {openEvidenceSession} from ${JSON.stringify(evidenceModule)};import {recordedContainerBackend} from ${JSON.stringify(backendModule)};
const evidence=await openEvidenceSession({root:${JSON.stringify(hostRoot)},sessionId:'abandoned',clock:{now:()=>Date.now(),sleep:async()=>{}}});
const backend=recordedContainerBackend({runtime:'docker',image:'node:24-bookworm',workspaceRoot:${JSON.stringify(workspace)},user:${JSON.stringify(`${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`)}},evidence);
await backend.run(['node','-e',"setInterval(()=>require('node:fs').appendFileSync('/workspace/death-canary','x'),20)"],{cwd:${JSON.stringify(workspace)},timeoutMs:30000});`,
    );
    const child = spawn(process.execPath, [program], { stdio: "ignore" });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      let ready = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        ready =
          (await readFile(join(workspace, "death-canary"), "utf8").catch(() => "")).length > 0;
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(ready).toBe(true);
      child.kill("SIGKILL");
      await exited;
      expect(await repairRuntimeResources(hostRoot, "abandoned")).toHaveLength(1);
      const before = await readFile(join(workspace, "death-canary"), "utf8");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await readFile(join(workspace, "death-canary"), "utf8")).toBe(before);
    } finally {
      child.kill("SIGKILL");
      await exited;
      await repairRuntimeResources(hostRoot, "abandoned");
    }
  },
  30000,
);
