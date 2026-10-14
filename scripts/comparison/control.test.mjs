import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  campaignState,
  cellFiles,
  FatalError,
  fatalInvocation,
  nextNumbered,
  processStart,
  releaseLock,
  revalidate,
  sameProcess,
  terminateGroup,
  updateLock,
  writeHalt,
  writeRecovery,
} from "./control.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const runs = () => {
  const root = mkdtempSync(join(tmpdir(), "comparison-control-"));
  roots.push(root);
  return root;
};
const digest = `sha256:${"0".repeat(64)}`;
const halt = (extra = {}) => ({
  schema: "swarm-ordinary-comparison.halt.v1",
  manifestDigest: digest,
  class: "endpoint",
  reason: "the endpoint process stopped",
  detectedAt: "2026-10-14T00:00:00.000Z",
  haltedAt: "2026-10-14T00:00:01.000Z",
  launch: { task: "calc-fix-add", arm: "swarm", order: 0 },
  attemptRecord: "calc-fix-add.swarm.halted-1.json",
  scratch: null,
  cleanup: { outcome: "terminated", wallMs: 120, deadlineMs: 10_000 },
  orphans: [],
  remaining: [{ task: "calc-fix-add", arm: "opencode", order: 1 }],
  identity: { pins: { model: "m" }, harnessDigest: digest, node: "v24", platform: "darwin" },
  runner: { pid: 1, started: "now" },
  notes: [],
  ...extra,
});

describe("the fatal classes", () => {
  it("name only the known classes and keep the moment they were seen", () => {
    const seen = new Date("2026-10-14T00:00:00Z");
    const fatal = new FatalError("scorer", "cannot judge", seen);
    expect(fatal.class).toBe("scorer");
    expect(fatal.detectedAt).toBe(seen);
    expect(fatal.message).toBe("cannot judge");
    expect(() => new FatalError("looks-bad", "x")).toThrow(/unknown fatal class/);
  });

  it("read an arm's runtime failure from its invocation, and nothing from an arm merely failing its task", () => {
    const base = {
      arm: "swarm",
      exitCode: 1,
      signal: null,
      stdout: '{"schema":"swarm.result.v1"}',
      evidenceDirectory: null,
      exists: () => true,
    };
    expect(fatalInvocation(base)).toBeNull();
    expect(fatalInvocation({ ...base, exitCode: 0 })).toBeNull();
    expect(fatalInvocation({ ...base, exitCode: 130 })).toBeNull();
    expect(fatalInvocation({ ...base, exitCode: null, signal: "SIGKILL(deadline)" })).toBeNull();
    expect(fatalInvocation({ ...base, exitCode: null, signal: "SIGKILL(interrupted)" })).toBeNull();
    expect(fatalInvocation({ ...base, exitCode: null, signal: null })).toMatchObject({
      class: "configuration",
    });
    expect(fatalInvocation({ ...base, exitCode: null, signal: "SIGTERM" })).toMatchObject({
      class: "interrupted",
      reason: expect.stringContaining("SIGTERM"),
    });
    expect(fatalInvocation({ ...base, stdout: "  \n" })).toMatchObject({ class: "configuration" });
    for (const code of [2, 4, 5])
      expect(fatalInvocation({ ...base, exitCode: code })).toMatchObject({
        class: "configuration",
        reason: expect.stringContaining(`exited ${code}`),
      });
    expect(
      fatalInvocation({ ...base, evidenceDirectory: "/nowhere", exists: () => false }),
    ).toMatchObject({
      class: "records",
      reason: expect.stringContaining("/nowhere"),
    });
    expect(
      fatalInvocation({ ...base, evidenceDirectory: "/there", exists: () => true }),
    ).toBeNull();
    const opencode = { ...base, arm: "opencode", exitCode: 0, stdout: '{"type":"step_finish"}' };
    expect(fatalInvocation(opencode)).toBeNull();
    expect(fatalInvocation({ ...opencode, exitCode: 4 })).toBeNull();
    expect(
      fatalInvocation({
        ...opencode,
        stdout:
          '{"type":"error","error":{"name":"UnknownError","data":{"message":"Unable to connect. Is the computer able to access the url?"}}}',
      }),
    ).toMatchObject({
      class: "configuration",
      reason: expect.stringContaining("Unable to connect"),
    });
  });
});

describe("the durable halt state", () => {
  it("is halted while there are more halts than recoveries, and numbers both append-only", () => {
    const directory = runs();
    expect(campaignState(directory)).toEqual({
      halts: [],
      recoveries: [],
      halted: false,
      lastHalt: null,
    });
    expect(nextNumbered(directory, "halt")).toBe("halt-1.json");
    expect(writeHalt(directory, halt())).toBe("halt-1.json");
    expect(campaignState(directory)).toMatchObject({ halted: true, lastHalt: "halt-1.json" });
    expect(() => writeHalt(directory, halt(), "halt-1.json")).toThrow(/EEXIST/);
    expect(() => writeHalt(directory, halt({ class: "oops" }))).toThrow();
    expect(
      writeRecovery(directory, {
        schema: "swarm-ordinary-comparison.recovery.v1",
        manifestDigest: digest,
        recoveredAt: "2026-10-14T00:01:00.000Z",
        clears: "halt-1.json",
        clearsDigest: digest,
        justification: "the server was restarted by hand",
        revalidation: {
          problems: [],
          harnessDigest: digest,
          node: "v24",
          endpointInstance: "pid 1 started now",
          models: ["m"],
          opencode: "1.14.48",
          swarmCliDigest: null,
        },
        completed: 1,
        remaining: [],
      }),
    ).toBe("recovery-1.json");
    expect(campaignState(directory)).toMatchObject({ halted: false, lastHalt: "halt-1.json" });
    expect(writeHalt(directory, halt())).toBe("halt-2.json");
    expect(campaignState(directory).halted).toBe(true);
    expect(readdirSync(directory).sort()).toEqual([
      "halt-1.json",
      "halt-2.json",
      "recovery-1.json",
    ]);
  });

  it("counts a cell's record and failed attempts, legacy infrastructure attempts included", () => {
    const directory = runs();
    writeFileSync(join(directory, "a-task.swarm.infrastructure-1.json"), "{}");
    writeFileSync(join(directory, "a-task.swarm.halted-1.json"), "{}");
    writeFileSync(join(directory, "a-task.opencode.json"), "{}");
    expect(cellFiles(directory, "a-task", "swarm")).toEqual({
      record: "a-task.swarm.json",
      recorded: false,
      failedAttempts: 2,
      nextHalted: "a-task.swarm.halted-2.json",
    });
    expect(cellFiles(directory, "a-task", "opencode")).toMatchObject({
      recorded: true,
      failedAttempts: 0,
    });
  });
});

describe("the runner lock", () => {
  it("admits one live holder, reports it to a second runner, and reads a dead holder as stale", () => {
    const directory = runs();
    const owner = {
      pid: process.pid,
      started: processStart(process.pid),
      launch: null,
      child: null,
    };
    expect(acquireLock(directory, owner)).toEqual({ acquired: true });
    const second = acquireLock(directory, { pid: 1, started: "x" });
    expect(second.acquired).toBe(false);
    expect(second.alive).toBe(true);
    expect(second.holder.pid).toBe(process.pid);
    updateLock(directory, owner, { launch: { task: "t", arm: "swarm", order: 0 } });
    expect(JSON.parse(readFileSync(join(directory, "runner.lock"), "utf8")).launch.task).toBe("t");
    expect(releaseLock(directory, { pid: 999_999 })).toBeNull();
    expect(readdirSync(directory)).toContain("runner.lock");
    expect(releaseLock(directory, owner)).toBeNull();
    expect(readdirSync(directory)).not.toContain("runner.lock");

    writeFileSync(
      join(directory, "runner.lock"),
      JSON.stringify({ pid: 2_147_000_001, started: "long ago" }),
    );
    const stale = acquireLock(directory, owner);
    expect(stale).toMatchObject({ acquired: false, alive: false });
    writeFileSync(join(directory, "runner.lock"), "not json");
    expect(acquireLock(directory, owner)).toMatchObject({
      acquired: false,
      alive: false,
      holder: { invalid: expect.any(String) },
    });
  });

  it("tells a reused pid from the recorded process by its start time", () => {
    expect(sameProcess(process.pid, processStart(process.pid))).toBe(true);
    expect(sameProcess(process.pid, "Mon Jan  1 00:00:00 1990")).toBe(false);
    expect(sameProcess(process.pid, null)).toBe(false);
    expect(processStart(2_147_000_001)).toBeNull();
  });

  it("terminates an owned process group within the deadline and reports one already gone", async () => {
    const { spawn } = await import("node:child_process");
    const child = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    const started = processStart(child.pid);
    const result = await terminateGroup(child.pid, started, 5000);
    expect(result).toMatchObject({ pid: child.pid, outcome: "terminated" });
    expect(result.wallMs).toBeLessThan(5000);
    expect(await terminateGroup(child.pid, started, 1000)).toMatchObject({
      outcome: "already-gone",
      wallMs: 0,
    });
  });
});

describe("revalidation", () => {
  const manifest = (pins = {}) => ({
    pins: {
      model: "m",
      endpoint: "http://127.0.0.1:1/v1",
      swarmCli: new URL(import.meta.url).pathname,
      swarmCliDigest: null,
      opencode: "1.0.0",
      node: process.version,
      harnessDigest: digest,
      ...pins,
    },
  });
  const healthy = async () => ({
    instance: "pid 1 started now",
    models: ["m", "n"],
    problem: null,
  });

  it("passes when every pin holds and names each pin that does not", async () => {
    const ok = await revalidate(manifest(), {
      probe: healthy,
      versionOf: () => "1.0.0",
      harness: () => digest,
    });
    expect(ok.problems).toEqual([]);
    expect(ok.observed).toMatchObject({
      models: ["m", "n"],
      opencode: "1.0.0",
      endpointInstance: "pid 1 started now",
    });
    expect(ok.observed.swarmCliDigest).toMatch(/^sha256:/);

    const wrong = await revalidate(
      manifest({ model: "other", opencode: "2.0.0", node: "v0.0.0", swarmCliDigest: digest }),
      {
        probe: healthy,
        versionOf: () => "1.0.0",
        harness: () => `sha256:${"1".repeat(64)}`,
      },
    );
    expect(wrong.class).toBe("configuration");
    expect(wrong.problems).toHaveLength(5);
    expect(wrong.problems.join("\n")).toMatch(/harness digest/);
    expect(wrong.problems.join("\n")).toMatch(/node is/);
    expect(wrong.problems.join("\n")).toMatch(/not the frozen model other/);
    expect(wrong.problems.join("\n")).toMatch(/Swarm CLI at/);
    expect(wrong.problems.join("\n")).toMatch(/opencode is 1.0.0/);

    const down = await revalidate(manifest(), {
      probe: async () => ({ instance: null, models: [], problem: "fetch failed" }),
      versionOf: () => "1.0.0",
      harness: () => digest,
    });
    expect(down.class).toBe("endpoint");
    expect(down.problems).toEqual([
      "the endpoint http://127.0.0.1:1/v1 did not answer: fetch failed",
    ]);

    const missing = await revalidate(manifest({ swarmCli: "/nowhere/cli.js" }), {
      probe: healthy,
      versionOf: () => "1.0.0",
      harness: () => digest,
    });
    expect(missing.problems).toEqual(["the Swarm CLI is not at /nowhere/cli.js"]);
  });
});
