import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
it("completes a narrow upgrade through the ordinary worker and final installed-version check", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-upgrade-worker-"));
  const workspace = join(root, "repo");
  const vendor = join(workspace, "vendor");
  const pack = join(root, "package");
  await mkdir(vendor, { recursive: true });
  await mkdir(pack);
  const env = { PATH: process.env.PATH, HOME: root };
  const run = (argv: string[], cwd = workspace) =>
    execute(argv[0] ?? "", argv.slice(1), { cwd, env, timeout: 30000 });
  const clock = createSystemClock();
  try {
    const versions = new Map<string, { manifest: string; lock: string }>();
    for (const version of ["1.0.0", "2.0.0"]) {
      await writeFile(
        join(pack, "package.json"),
        JSON.stringify({ name: "fixture-lib", version, main: "index.cjs" }),
      );
      await writeFile(join(pack, "index.cjs"), "module.exports = n => n + 1;\n");
      await run(["npm", "pack", "--ignore-scripts", "--pack-destination", vendor], pack);
      const archive = `fixture-lib-${version}.tgz`;
      const integrity = `sha512-${createHash("sha512")
        .update(await readFile(join(vendor, archive)))
        .digest("base64")}`;
      const manifest = {
        name: "fixture",
        version: "1.0.0",
        scripts: { test: "node --test", build: "node -e \"require('fixture-lib')\"" },
        dependencies: { "fixture-lib": version },
      };
      const lock = {
        name: "fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "fixture", version: "1.0.0", dependencies: manifest.dependencies },
          "node_modules/fixture-lib": { version, resolved: `file:vendor/${archive}`, integrity },
        },
      };
      versions.set(version, { manifest: JSON.stringify(manifest), lock: JSON.stringify(lock) });
    }
    const base = versions.get("1.0.0"),
      candidate = versions.get("2.0.0");
    if (!base || !candidate) throw Error("fixture versions were not constructed");
    await writeFile(join(workspace, "package.json"), base.manifest);
    await writeFile(join(workspace, "package-lock.json"), base.lock);
    await writeFile(join(workspace, ".gitignore"), "node_modules/\n");
    await writeFile(
      join(workspace, "behavior.test.cjs"),
      "const{test}=require('node:test');const assert=require('node:assert/strict');test('increment',()=>assert.equal(require('fixture-lib')(2),3));\n",
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
      await run(argv);
    const baseCommit = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
    const evidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "upgrade",
      clock,
    });
    const goal = await declareGoalContract(evidence, {
      version: 1,
      goal: "Upgrade fixture-lib while preserving increment",
      preset: {
        kind: "upgrade",
        manager: "npm",
        manifest: "package.json",
        lockfile: "package-lock.json",
        dependencies: [{ name: "fixture-lib", section: "dependencies", version: "2.0.0" }],
        sourcePaths: [],
      },
      requirements: [
        { id: "increment", description: "Two increments to three", checks: ["increment"] },
      ],
      checks: [
        {
          id: "increment",
          command: "pinned increment",
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
            argv: ["node", "-e", "console.log(require('fixture-lib')(2))"],
            exitCode: 0,
            stdout: [{ kind: "equals", value: "3\n" }],
            stderr: [],
          },
        },
      ],
      immutablePaths: ["behavior.test.cjs"],
    });
    const context = {
      contract: goal,
      workspace,
      baseCommit,
      evidence,
      clock,
      signal: new AbortController().signal,
      isolation: null,
      install: true,
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
      installDependencies: true,
      model: createRecordingModelClient(
        createFixtureModelClient({
          modelId: "fixture:upgrade",
          turns: [
            respondWithToolCalls("declare", [
              {
                callId: "declare",
                toolName: "declare_file_set",
                input: { files: ["package.json", "package-lock.json"] },
              },
            ]),
            respondWithToolCalls("upgrade", [
              {
                callId: "manifest",
                toolName: "write",
                input: { path: "package.json", content: candidate.manifest },
              },
              {
                callId: "lock",
                toolName: "write",
                input: { path: "package-lock.json", content: candidate.lock },
              },
            ]),
            respondWithText("done"),
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
      abortSignal: context.signal,
      homeDir: root,
      gateOptions: { acceptanceGate: taskGoalGate(context) },
    });
    expect(result.gates.outcome.finalCycle.statuses["task-acceptance"]).toBe("passed");
    expect(result.green).toBe(true);
    expect((await finalizeTaskGoal(context)).acceptable).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
