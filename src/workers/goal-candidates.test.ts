import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { createFixedRandom } from "../core/test-doubles.ts";
import { bundleSourceFromRecorder, exportBundle } from "../evidence/bundle.ts";
import { freezeGoalContract } from "../evidence/goal-contract.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { createEphemeralSigningKey } from "../evidence/signing.ts";
import { verifyBundle } from "../evidence/verifier/verify.mjs";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { replayController } from "./controller-state.ts";
import { renderParallelReport } from "./parallel-report.ts";
import { runInParallel } from "./parallel-run.ts";
import { readTaskGraph } from "./task-graph.ts";

const git = promisify(execFile);
it.each([false, true])(
  "requires complete goal alternatives and repairs all rejected attempts (repair=%s)",
  async (repair) => {
    const root = await mkdtemp(join(tmpdir(), "whole-goal-selection-"));
    try {
      const repositoryRoot = join(root, "repo");
      await mkdir(repositoryRoot);
      await writeFile(
        join(repositoryRoot, "package.json"),
        JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
      );
      await writeFile(join(repositoryRoot, "a.js"), "export const a = 1;\n");
      await writeFile(join(repositoryRoot, "b.js"), "export const b = 1;\n");
      await writeFile(
        join(repositoryRoot, "base.test.js"),
        "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('regression',()=>assert.ok(true));\n",
      );
      await git("git", ["init", "-q", repositoryRoot]);
      await git("git", ["-C", repositoryRoot, "add", "."]);
      await git("git", [
        "-C",
        repositoryRoot,
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "-qm",
        "base",
      ]);
      const clock = createSystemClock();
      const coordinator = await openEvidenceSession({
        root: join(root, "sessions"),
        sessionId: "queue",
        clock,
      });
      const goalContract = freezeGoalContract({
        version: 1,
        goal: "a becomes two and b becomes three",
        selection: "change-size",
        requirements: [
          { id: "read", description: "a is two", checks: ["read"] },
          { id: "write", description: "b is three", checks: ["write"] },
        ],
        immutablePaths: ["base.test.js"],
        checks: [
          {
            id: "read",
            author: "user",
            exposure: "withheld",
            command: "node accept-a.mjs",
            artifacts: [
              {
                path: "accept-a.mjs",
                content:
                  "import assert from 'node:assert/strict'; import {a} from './a.js'; assert.equal(a,2);\n",
              },
            ],
          },
          {
            id: "write",
            author: "user",
            exposure: "withheld",
            command: "node accept-b.mjs",
            artifacts: [
              {
                path: "accept-b.mjs",
                content:
                  "import assert from 'node:assert/strict'; import {b} from './b.js'; assert.equal(b,3);\n",
              },
            ],
          },
        ],
      }).contract;
      const calls: string[] = [];
      const completed = await runInParallel({
        repositoryRoot,
        baseRef: "HEAD",
        tasks: ["read", "write"],
        graph: readTaskGraph({
          goal: goalContract.goal,
          nodes: [
            {
              id: "read",
              title: "read",
              instruction: "change a",
              files: ["a.js", "noise.test.js"],
            },
            { id: "write", title: "write", instruction: "change b", files: ["b.js"] },
          ],
        }),
        goalContract,
        runId: "selection",
        scratchRoot: join(root, "trees"),
        coordinator,
        clock,
        random: createFixedRandom(),
        emit: () => {},
        maxSteps: 8,
        attempts: 0,
        repairAttempts: repair ? 1 : 0,
        redundancy: 2,
        concurrency: 2,
        modelSpec: "fixture:selection",
        maxTokens: 1000000,
        abortSignal: new AbortController().signal,
        createWorkerSession: (workerId) =>
          openEvidenceSession({ root: join(root, "sessions"), sessionId: workerId, clock }),
        createModel(workerId) {
          calls.push(workerId);
          const incomplete = !workerId.includes("repair") && (repair || workerId.endsWith("-1"));
          const files = incomplete
            ? {
                "a.js": "export const a = 2;\n",
                "noise.test.js":
                  "import {test} from 'node:test'; import assert from 'node:assert/strict';\n" +
                  Array.from(
                    { length: 12 },
                    (_, index) => `test('unrelated ${index}',()=>assert.ok(true));\n`,
                  ).join(""),
              }
            : { "a.js": "export const a = 2;\n", "b.js": "export const b = 3;\n" };
          return createFixtureModelClient({
            modelId: "fixture:selection",
            turns: [
              respondWithToolCalls("declare", [
                { callId: "d", toolName: "declare_file_set", input: { files: Object.keys(files) } },
              ]),
              ...Object.entries(files).map(([path, content], index) =>
                respondWithToolCalls("edit", [
                  { callId: `w${index}`, toolName: "write", input: { path, content } },
                ]),
              ),
              respondWithText("done"),
            ],
          });
        },
      });
      expect(calls.slice(0, 2).sort()).toEqual([
        "complete-goal-attempt-1",
        "complete-goal-attempt-2",
      ]);
      expect(calls.slice(2)).toEqual(repair ? ["complete-goal-repair-1"] : []);
      expect(completed.workers.every((worker) => worker.green)).toBe(true);
      const selection = completed.goalSelections?.[0];
      expect(selection?.winner).toBe(repair ? null : "complete-goal-attempt-2");
      expect(selection?.candidates[0]?.reason).toContain("write");
      if (repair) expect(completed.goalSelections?.[1]?.winner).toBe("complete-goal-repair-1");
      expect(completed.outcome.goalAccepted).toBe(true);
      expect(completed.outcome.tasks.map((task) => task.members)).toEqual([
        ["complete-goal"],
        ["complete-goal"],
      ]);
      expect(replayController(coordinator).graph?.ordinal).toBe(1);
      expect(
        renderParallelReport(completed, { repositoryRoot, baseRef: "HEAD" }).join("\n"),
      ).toContain(repair ? "0/2 acceptable" : "1/2 acceptable");
      const bundle = join(root, "bundle");
      await exportBundle({
        source: bundleSourceFromRecorder(coordinator),
        destination: bundle,
        signingKey: createEphemeralSigningKey(),
        clock,
      });
      const lines: string[] = [];
      expect(
        verifyBundle(bundle, (line: string) => lines.push(line)),
        lines.join("\n"),
      ).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
