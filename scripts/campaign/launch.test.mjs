import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { treeContract } from "./arms-b.mjs";
import { commandLog, runCommand, storeBlob } from "./exec.mjs";
import { attemptsOf, campaignContract, nextAttempt } from "./launch.mjs";
import { readonlyGlobs, veraGoalYaml } from "./vera-goal.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), "campaign-launch-"));
  roots.push(root);
  return root;
};

const contract = {
  version: 1,
  goal: "g",
  requirements: [
    { id: "first", description: "a", checks: ["one"] },
    { id: "second", description: "b", checks: ["one"] },
  ],
  checks: [
    { id: "one", command: "node --test", author: "user", exposure: "shared", artifacts: [] },
  ],
  immutablePaths: ["test"],
  selection: "stable",
};

describe("the retry rule", () => {
  it("runs a fresh launch, skips a decided one, and reruns only infrastructure failures", () => {
    expect(nextAttempt([], 2)).toBe(1);
    expect(nextAttempt([{ decision: "refuse" }], 2)).toBeNull();
    expect(nextAttempt([{ decision: "inconclusive" }], 2)).toBeNull();
    expect(nextAttempt([{ decision: "infrastructure-failure" }], 2)).toBe(2);
    const three = Array.from({ length: 3 }, () => ({ decision: "infrastructure-failure" }));
    expect(nextAttempt(three, 2)).toBeNull();
  });

  it("reads attempts in numeric order", () => {
    const directory = scratch();
    for (const n of [1, 2, 10])
      writeFileSync(join(directory, `attempt-${n}.json`), JSON.stringify({ attempt: n }));
    writeFileSync(join(directory, "notes.txt"), "not an attempt");
    expect(attemptsOf(directory).map((one) => one.attempt)).toEqual([1, 2, 10]);
    expect(attemptsOf(join(directory, "absent"))).toEqual([]);
  });
});

describe("what each arm is handed", () => {
  it("seals the reference for every requirement for swarm-verify and strips it from the tree copy", () => {
    const loaded = { contract, patches: new Map([["reference", "diff --git a/x b/x\n"]]) };
    const sealed = campaignContract(loaded);
    expect(sealed.challenges.references.map((one) => one.requirement)).toEqual(["first", "second"]);
    expect(sealed.challenges.references.every((one) => one.patch === "diff --git a/x b/x\n")).toBe(
      true,
    );
    expect(treeContract(sealed).challenges).toBeUndefined();
    expect(treeContract(sealed).checks).toEqual(contract.checks);
  });

  it("gives VERA the project tests, the visible checks and readonly acceptance paths at three depths", () => {
    const yaml = veraGoalYaml(
      { taskText: "Fix it.\nMore.", projectTest: ["npm", "test"] },
      contract,
    );
    expect(yaml).toContain('args: ["npm", "test"]');
    expect(yaml).toContain('".campaign/visible-runner.mjs"');
    expect(readonlyGlobs(contract)).toContain("test/*/*/*");
    expect(readonlyGlobs(contract)).toContain("acceptance/visible/*");
  });
});

describe("running and recording a command", () => {
  it("keeps complete output by digest, once", async () => {
    const directory = scratch();
    const log = commandLog(join(directory, "blobs"));
    const ran = await log.run([process.execPath, "-e", "console.log('x'.repeat(10))"], {
      cwd: directory,
      timeoutMs: 20_000,
    });
    expect(ran.exitCode).toBe(0);
    expect(log.commands[0].stdoutBytes).toBe(11);
    expect(storeBlob(join(directory, "blobs"), Buffer.from(`${"x".repeat(10)}\n`))).toBe(
      log.commands[0].stdoutDigest,
    );
  });

  it("reports a deadline or an interrupt as a signal, not as an exit code", async () => {
    const directory = scratch();
    mkdirSync(directory, { recursive: true });
    const late = await runCommand([process.execPath, "-e", "setTimeout(() => {}, 60000)"], {
      cwd: directory,
      timeoutMs: 300,
    });
    expect(late.exitCode).toBeNull();
    expect(late.signal).toBe("SIGKILL(deadline)");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const cut = await runCommand([process.execPath, "-e", "setTimeout(() => {}, 60000)"], {
      cwd: directory,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    expect(cut.signal).toBe("SIGKILL(interrupted)");
  });
});
