import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { installFromLockfile } from "./dependency-install.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

const execute = promisify(execFile);
const clock = createSystemClock();
let root = "";
let workspace = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-dependency-"));
  workspace = join(root, "repo");
  await execute("git", ["init", "--quiet", workspace]);
  await writeFile(join(workspace, ".gitignore"), "node_modules/\n");
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: { prepare: "node -e \"require('fs').writeFileSync('lifecycle-ran','yes')\"" },
    }),
  );
  await writeFile(
    join(workspace, "package-lock.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "fixture", version: "1.0.0" } },
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const settings = async () => ({
  workspace,
  timeoutMs: 30000,
  commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
  evidence: await openEvidenceSession({ root: join(root, "sessions"), sessionId: "setup", clock }),
});

it("executes real frozen setup without lifecycle scripts, recording intent before completion", async () => {
  const options = await settings();
  const observed = await installFromLockfile(options);
  expect(observed.succeeded).toBe(true);
  await expect(access(join(workspace, "lifecycle-ran"))).rejects.toThrow();
  expect(
    options.evidence
      .records()
      .map((record) => options.evidence.payloads().get(record.payloadDigest)),
  ).toMatchObject([
    { phase: "intent", argv: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"] },
    { phase: "completed", succeeded: true },
  ]);
});

it("refuses an installer that changes source despite exit zero", async () => {
  const options = await settings();
  const observed = await installFromLockfile({
    ...options,
    commands: {
      ...options.commands,
      runVouched: async (_argv, invocation) => {
        expect(invocation.timeoutMs).toBe(17);
        await writeFile(join(workspace, "package.json"), "{}\n");
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, unavailable: null };
      },
    },
    timeoutMs: 17,
  });
  expect(observed.succeeded).toBe(false);
  expect(observed.detail).toContain("changed source");
  expect(await readFile(join(workspace, "package.json"), "utf8")).toBe("{}\n");
});

it("preserves an ambiguous setup and refuses to execute it again", async () => {
  const options = await settings();
  let launches = 0;
  const commands = {
    ...options.commands,
    runVouched: async () => {
      launches++;
      throw new Error("lost process observation");
    },
  };
  await expect(installFromLockfile({ ...options, commands })).rejects.toThrow("lost process");
  await expect(installFromLockfile({ ...options, commands })).rejects.toThrow("unresolved effect");
  expect(launches).toBe(1);
  expect(options.evidence.records()).toHaveLength(1);
});

it("does not reserve or launch setup after cancellation", async () => {
  const options = await settings();
  await expect(
    installFromLockfile({ ...options, signal: AbortSignal.abort(new Error("cancelled")) }),
  ).rejects.toThrow("cancelled");
  expect(options.evidence.records()).toHaveLength(0);
});
