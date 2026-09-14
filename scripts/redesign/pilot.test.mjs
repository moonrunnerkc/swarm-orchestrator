import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { freezeGoalContract } from "../../src/evidence/goal-contract.ts";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "../../src/providers/fixture-provider.ts";
import { filteredCheck, pilotCaseIds, quote } from "./pilot-cases.mjs";
import { instrumentContract } from "./pilot-prepare.mjs";
import { assertLocalModel } from "./pilot-run.mjs";
import { projectGateOptions } from "./pilot-runtime.mjs";
import { executePilotGoal } from "./pilot-worker.mjs";

let scratch;
afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
  scratch = undefined;
});
it("pins 24 different goals and preserves shell literals and Node flag ordering", () => {
  expect(new Set(pilotCaseIds).size).toBe(24);
  expect(quote("don't $(touch unwanted) `echo words`")).toBe(
    "'don'\\''t $(touch unwanted) `echo words`'",
  );
  const command = filteredCheck({ id: "koajs-koa-1998", runner: "node --test" }, "check.js", [
    `ctx.assert.\${method}()`,
  ]);
  expect(command.indexOf("--test-name-pattern")).toBeLessThan(command.indexOf("check.js"));
  expect(command).toContain("\\$\\{method\\}");
});
it("refuses remote model aliases, missing weights and changed identities", () => {
  const models = [
    { name: "local", digest: "abc" },
    { name: "remote", digest: "def", remote_host: "elsewhere" },
  ];
  expect(assertLocalModel({ models }, "local", "abc").digest).toBe("abc");
  for (const [name, digest] of [
    ["local", "wrong"],
    ["remote", "def"],
    ["missing", "abc"],
  ])
    expect(() => assertLocalModel({ models }, name, digest)).toThrow(/unavailable or changed/);
});
it("keeps acceptance outside producer writes and includes public Python typing", () => {
  const contract = instrumentContract(
    {
      id: "pallets-click-a1d87858",
      language: "python",
      goal: "PathLike edit",
      immutablePaths: ["pyproject.toml"],
    },
    "sealed",
    "assert True\n",
  );
  expect(contract.checks[0].artifacts.map((artifact) => artifact.path)).toEqual([
    "swarm_sealed_swarm_acceptance.py",
    "swarm_sealed_swarm_acceptance_typing.py",
  ]);
  expect(contract.checks[0].command).toContain(" && mypy ");
  expect(contract.checks[0].exposure).toBe("withheld");
});
it("preserves project checks and initializes the generated chess parser", () => {
  expect(
    projectGateOptions({ id: "jhlywa-chess-js-554", repository: "jhlywa/chess.js" })
      .commandOverrides.tests,
  ).toBe("npm run parser && npm run check");
  expect(projectGateOptions({ repository: "pallets/click" }).commandOverrides.tests).toContain(
    "pytest --basetemp=",
  );
  expect(
    filteredCheck({ id: "jhlywa-chess-js-451", runner: "jest" }, "test.ts", ["null move"]),
  ).toMatch(/^npm run parser && /);
});
it.each([false, true])(
  "runs the pilot's public worker and fresh final checks (omit goal: %s)",
  async (omission) => {
    scratch = await mkdtemp(join(tmpdir(), "swarm-pilot-driver-"));
    const clone = join(scratch, "source");
    await mkdir(clone);
    const files = {
      "package.json": JSON.stringify({
        name: "pilot-fixture",
        version: "1.0.0",
        type: "module",
        scripts: { build: "node --check value.js", test: "node --test" },
      }),
      "package-lock.json": JSON.stringify({
        name: "pilot-fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: { "": { name: "pilot-fixture", version: "1.0.0" } },
      }),
      ".gitignore": "node_modules/\n",
      "value.js": "export const value=1;\n",
      "base.test.js":
        "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {value} from './value.js'; test('positive',()=>assert.ok(value>0));\n",
    };
    for (const [path, content] of Object.entries(files))
      await writeFile(join(clone, path), content);
    const git = (...argv) => execFileSync("git", argv, { cwd: clone, encoding: "utf8" }).trim();
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "base");
    const baseCommit = git("rev-parse", "HEAD");
    const contract = (exposure) =>
      freezeGoalContract({
        version: 1,
        goal: "Set value to 2",
        requirements: [{ id: "value", description: "value equals 2", checks: ["value"] }],
        immutablePaths: ["package.json", "package-lock.json"],
        checks: [
          {
            id: "value",
            command: `node ${exposure}.mjs`,
            author: "user",
            exposure: "withheld",
            artifacts: [
              {
                path: `${exposure}.mjs`,
                content:
                  "import assert from 'node:assert/strict'; import {value} from './value.js'; assert.equal(value,2);\n",
              },
            ],
          },
        ],
      }).contract;
    const root = join(scratch, "launches");
    await mkdir(root);
    const outcome = await executePilotGoal({
      candidate: {
        id: "driver-fixture",
        repository: "maintainer/fixture",
        language: "javascript",
        image: null,
        baseCommit,
        clone,
        goal: "Set value to 2",
        contracts: { sealed: contract("sealed"), "held-back": contract("withheld") },
      },
      arm: { id: "single", role: "single" },
      execution: {
        executionId: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        budget: { tokens: 200000, wallMs: 60000 },
        signal: new AbortController().signal,
      },
      root,
      settings: {
        model: "fixture",
        endpoint: "http://127.0.0.1:11434/v1",
        maxSteps: 5,
        plannerSteps: 5,
        attempts: 0,
        repairAttempts: 0,
        graphRevisions: 0,
        modelConcurrency: 1,
        testConcurrency: 1,
        worktreeConcurrency: 1,
        cleanupMs: 60000,
      },
      createModel: () =>
        createFixtureModelClient({
          modelId: "fixture",
          turns: [
            respondWithToolCalls("scope", [
              { callId: "d", toolName: "declare_file_set", input: { files: ["value.js"] } },
            ]),
            respondWithToolCalls("edit", [
              {
                callId: "w",
                toolName: "write",
                input: { path: "value.js", content: `export const value=${omission ? 3 : 2};\n` },
              },
            ]),
            respondWithText("done"),
          ],
        }),
    });
    expect(outcome.cleanup).toBe("confirmed");
    expect(outcome.certified).toBe(!omission);
    expect(outcome.heldBackAccepted).toBe(!omission);
    expect(outcome.goal.inputTokens).toBeGreaterThan(0);
    expect(outcome.goal.unknownCalls).toBe(0);
    expect(outcome.goal.partialBranch).toMatch(/integration$/);
    const observed = JSON.parse(
      await readFile(
        join(
          root,
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          "observation.json",
        ),
        "utf8",
      ),
    );
    expect(observed.integrity).toBe(0);
  },
  120000,
);
