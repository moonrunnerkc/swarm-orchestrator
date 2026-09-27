import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import { preflightTaskGoal } from "./cli-task-goal.ts";
import { declareGoalContract } from "./evidence/goal-contract.ts";
import { openEvidenceSession } from "./evidence/session.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";

it("requires a behavioral base failure before a bugfix can spend model tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-preset-preflight-"));
  const evidenceRoot = await mkdtemp(join(tmpdir(), "swarm-preset-evidence-"));
  const clock = createSystemClock();
  const commands = createNodeCommandRunner(clock, harnessChildEnvironment());
  const run = (argv: string[]) => commands.runVouched(argv, { cwd: root, timeoutMs: 10000 });
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "fixture", type: "module", scripts: { test: "node --test" } }),
    );
    await writeFile(join(root, "value.mjs"), "export const value = 2;\n");
    await writeFile(
      join(root, "value.test.mjs"),
      "import {test} from 'node:test';import assert from 'node:assert/strict';test('runtime',()=>assert.equal(1+1,2));\n",
    );
    for (const argv of [
      ["git", "init", "-q"],
      ["git", "add", "--all"],
      [
        "git",
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "base",
      ],
    ])
      expect((await run(argv)).exitCode).toBe(0);
    const baseCommit = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
    for (const expected of ["1\n", "2\n"]) {
      const evidence = await openEvidenceSession({
        root: evidenceRoot,
        sessionId: expected.startsWith("1") ? "reproduced" : "vacuous",
        clock,
      });
      const contract = await declareGoalContract(evidence, {
        version: 1,
        goal: "Return one",
        preset: { kind: "bugfix", reproducer: "value" },
        requirements: [
          { id: "value", description: "Return the requested value", checks: ["value"] },
        ],
        checks: [
          {
            id: "value",
            command: "pinned output",
            author: "user",
            exposure: "withheld",
            artifacts: [],
            behavior: {
              kind: "cli",
              cwd: ".",
              timeoutMs: 3000,
              maxOutputBytes: 4000,
              toolchain: "Node",
              network: "inherit",
              argv: [
                "node",
                "--input-type=module",
                "-e",
                "import {value} from './value.mjs';console.log(value)",
              ],
              exitCode: 0,
              stdout: [{ kind: "equals", value: expected }],
              stderr: [],
            },
          },
        ],
        immutablePaths: [],
      });
      const action = preflightTaskGoal({
        workspace: root,
        baseCommit,
        contract,
        evidence,
        clock,
        signal: new AbortController().signal,
        isolation: null,
        install: false,
      });
      if (expected.startsWith("1")) await expect(action).resolves.toBeUndefined();
      else await expect(action).rejects.toThrow("base control was not established");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(evidenceRoot, { recursive: true, force: true });
  }
}, 30000);
