import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { runAgentTask } from "./agent-run.ts";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import { presetTaskContract } from "./cli-task-contract.ts";
import { finalizeTaskGoal, taskGoalGate } from "./cli-task-goal.ts";
import { createFixedRandom } from "./core/test-doubles.ts";
import { declareGoalContract } from "./evidence/goal-contract.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { openEvidenceSession } from "./evidence/session.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "./providers/fixture-provider.ts";

const execute = promisify(execFile);

/**
 * A bugfix preset whose fix edits a line in the middle of an existing file. The acceptance gate
 * and the final verification apply the change in a fresh checkout; through the zero-context diff
 * `git apply` refused it, and once it applied, the final verification's source digest had to still
 * name the worker's own recorded diff. Found by a development run of check strengthening.
 */
it("verifies a preset fix that edits an existing file, bound to the worker's assessed source", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-bugfix-worker-"));
  const workspace = join(root, "repo");
  const run = (argv: string[]) =>
    execute(argv[0] ?? "", argv.slice(1), {
      cwd: workspace,
      env: { PATH: process.env.PATH, HOME: root },
    });
  const clock = createSystemClock();
  try {
    await execute("mkdir", ["-p", workspace]);
    await writeFile(
      join(workspace, "package.json"),
      '{"name":"clamp","version":"1.0.0","private":true,"type":"module","scripts":{"test":"node --test"}}\n',
    );
    await writeFile(
      join(workspace, "clamp.mjs"),
      "export function clamp(n, lo, hi) {\n  return n;\n}\n",
    );
    await writeFile(
      join(workspace, "cli.mjs"),
      'import { clamp } from "./clamp.mjs";\nconst [n, lo, hi] = process.argv.slice(2).map(Number);\nconsole.log(clamp(n, lo, hi));\n',
    );
    await writeFile(
      join(workspace, "clamp.test.mjs"),
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "./clamp.mjs";\ntest("middle", () => assert.equal(clamp(5, 0, 10), 5));\n',
    );
    for (const argv of [
      ["git", "init", "-q"],
      ["git", "add", "--all"],
      ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"],
    ])
      await run(argv);
    const baseCommit = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
    const evidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "bugfix",
      clock,
    });
    const goal = await declareGoalContract(evidence, {
      version: 1,
      goal: "clamp never returns more than hi",
      preset: { kind: "bugfix", reproducer: "ceiling" },
      requirements: [{ id: "ceiling", description: "clamp(11, 0, 10) is 10", checks: ["ceiling"] }],
      checks: [
        {
          id: "ceiling",
          command: "node cli.mjs 11 0 10",
          author: "user",
          exposure: "shared",
          artifacts: [],
          behavior: {
            kind: "cli",
            cwd: ".",
            timeoutMs: 5000,
            maxOutputBytes: 4000,
            toolchain: "node",
            network: "inherit",
            argv: ["node", "cli.mjs", "11", "0", "10"],
            exitCode: 0,
            stdout: [{ kind: "equals", value: "10\n" }],
            stderr: [],
          },
        },
      ],
      immutablePaths: ["clamp.test.mjs"],
    });
    const context = {
      contract: goal,
      workspace,
      baseCommit,
      evidence,
      clock,
      signal: new AbortController().signal,
      isolation: null,
      install: false,
    };
    const result = await runAgentTask({
      task: goal.goal,
      contract: presetTaskContract({
        goal,
        task: goal.goal,
        maxSteps: 4,
        maxWallMs: 60000,
        network: "unrestricted",
      }),
      workspace,
      baseRef: baseCommit,
      maxSteps: 4,
      attempts: 0,
      model: createRecordingModelClient(
        createFixtureModelClient({
          modelId: "fixture:bugfix",
          turns: [
            respondWithToolCalls("declare", [
              { callId: "declare", toolName: "declare_file_set", input: { files: ["clamp.mjs"] } },
            ]),
            respondWithToolCalls("fix", [
              {
                callId: "fix",
                toolName: "write",
                input: {
                  path: "clamp.mjs",
                  content:
                    "export function clamp(n, lo, hi) {\n  return Math.min(Math.max(n, lo), hi);\n}\n",
                },
              },
            ]),
            respondWithText("fixed"),
          ],
        }),
        evidence,
      ),
      evidence,
      fileSet: createFileSetRegistry(evidence),
      clock,
      random: createFixedRandom(),
      emit: () => {},
      confirm: async () => "no",
      abortSignal: new AbortController().signal,
      homeDir: root,
      gateOptions: { acceptanceGate: taskGoalGate(context) },
    });
    expect(result.green).toBe(true);
    const verdict = await finalizeTaskGoal(context);
    expect(verdict.acceptable).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
