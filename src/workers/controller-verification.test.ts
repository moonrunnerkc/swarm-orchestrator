import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { declareGoalContract } from "../evidence/goal-contract.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { hostExecutionBackend } from "../exec/execution-mode.ts";
import { verifyControllerCommit } from "./controller-verification.ts";
import type { ParallelRunOptions } from "./parallel-run.ts";

it("checks both control and repaired commits inside the backend-accessible scratch root", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-controller-verifier-"));
  try {
    const repositoryRoot = join(root, "repo");
    const scratchRoot = join(root, "shared");
    await mkdir(repositoryRoot);
    await mkdir(scratchRoot);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
    await writeFile(
      join(repositoryRoot, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
    );
    await writeFile(join(repositoryRoot, "value.js"), "export const value = 1;\n");
    await writeFile(
      join(repositoryRoot, "value.test.js"),
      "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {value} from './value.js'; test('positive', () => assert.ok(value > 0));\n",
    );
    git("init", "-q");
    const commit = (message: string) => {
      git("add", ".");
      git(
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "-qm",
        message,
      );
      return git("rev-parse", "HEAD");
    };
    const baseCommit = commit("base");
    await writeFile(join(repositoryRoot, "value.js"), "export const value = 2;\n");
    const repairedCommit = commit("repair");
    const clock = createSystemClock();
    const coordinator = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "verify",
      clock,
    });
    const goalContract = await declareGoalContract(coordinator, {
      version: 1,
      goal: "Set value to two",
      selection: "stable",
      immutablePaths: [],
      requirements: [{ id: "value", description: "value is two", checks: ["value"] }],
      checks: [
        {
          id: "value",
          author: "user",
          exposure: "withheld",
          command: "node acceptance.mjs",
          artifacts: [
            {
              path: "acceptance.mjs",
              content:
                "import assert from 'node:assert/strict'; import {value} from './value.js'; assert.equal(value, 2);\n",
            },
          ],
        },
      ],
    });
    const checkouts = new Set<string>();
    const options: ParallelRunOptions & { goalContract: typeof goalContract } = {
      repositoryRoot,
      scratchRoot,
      baseRef: baseCommit,
      goalContract,
      coordinator,
      clock,
      tasks: [],
      runId: "verification",
      maxSteps: 1,
      attempts: 1,
      redundancy: 1,
      concurrency: 1,
      modelSpec: "unused",
      abortSignal: new AbortController().signal,
      random: { next: () => 0 },
      emit: () => {},
      createWorkerSession: async () => {
        throw new Error("verification must not create a worker");
      },
      createModel: () => {
        throw new Error("verification must not call a model");
      },
      verificationIsolation: (checkout) => ({
        ...hostExecutionBackend,
        run: async (argv, commandOptions) => {
          const path = relative(scratchRoot, commandOptions.cwd);
          if (path === ".." || path.startsWith(`..${sep}`))
            throw new Error("verifier checkout is outside the backend-accessible root");
          checkouts.add(checkout);
          return hostExecutionBackend.run(argv, commandOptions);
        },
      }),
    };
    const control = await verifyControllerCommit(options, baseCommit, baseCommit);
    const repaired = await verifyControllerCommit(options, baseCommit, repairedCommit);
    expect(control.verification.regression).toBe("pass");
    expect(control.verification.task).toBe("rejected");
    expect(control.verification.verified).toBe(false);
    expect(repaired.verification.regression).toBe("pass");
    expect(repaired.verification.task).toBe("accepted");
    expect(repaired.verification.verified).toBe(true);
    expect(checkouts.size).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
