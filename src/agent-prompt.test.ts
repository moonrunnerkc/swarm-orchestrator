import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { legacyWorkerPrompt } from "./agent-prompt.ts";
import { runAgentTask, systemPrompt } from "./agent-run.ts";
import { createFixedRandom, createTestClock } from "./core/test-doubles.ts";
import { digestOfBytes } from "./evidence/canonical-json.ts";
import { openEvidenceSession } from "./evidence/session.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "./providers/fixture-provider.ts";

it("preserves the exact historical default while concise behavior is measured", () => {
  expect(systemPrompt).toBe(legacyWorkerPrompt);
  expect(digestOfBytes(systemPrompt)).toBe(
    "sha256:381b33f6ddcf544a1aa5bb2697b8bf78faefc864b1dcb274bd750467adedf453",
  );
});

it("serves the full reference through the public chokepoint and keeps a failed check red", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "swarm-concise-"));
  try {
    const workspace = join(scratch, "repo");
    await mkdir(workspace);
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
    );
    await writeFile(join(workspace, "value.js"), "export const value = 1;\n");
    await writeFile(
      join(workspace, "value.test.js"),
      "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {value} from './value.js'; test('value',()=>assert.equal(value,1));\n",
    );
    const git = async (...args: string[]) => promisify(execFile)("git", args, { cwd: workspace });
    await git("init", "--quiet");
    await git("add", ".");
    await git(
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--quiet",
      "-m",
      "seed",
    );
    const clock = createTestClock(1000);
    const evidence = await openEvidenceSession({
      root: join(scratch, "sessions"),
      sessionId: "concise",
      clock,
    });
    const outcome = await runAgentTask({
      promptProfile: "concise",
      task: "change value",
      workspace,
      baseRef: "HEAD",
      maxSteps: 6,
      attempts: 0,
      model: createFixtureModelClient({
        modelId: "fixture",
        turns: [
          respondWithToolCalls("inspect vocabulary", [
            { callId: "reference", toolName: "claim_reference", input: {} },
            { callId: "declare", toolName: "declare_file_set", input: { files: ["value.js"] } },
          ]),
          respondWithToolCalls("change", [
            {
              callId: "write",
              toolName: "write",
              input: { path: "value.js", content: "export const value = 2;\n" },
            },
          ]),
          respondWithText("everything passed"),
        ],
      }),
      evidence,
      fileSet: createFileSetRegistry(evidence),
      clock,
      random: createFixedRandom(),
      emit: () => {},
      confirm: async () => "no" as const,
      abortSignal: new AbortController().signal,
      homeDir: scratch,
    });
    expect(outcome.green).toBe(false);
    const reference = evidence
      .records()
      .filter((record) => record.type === "tool-call")
      .map((record) => evidence.payloads().get(record.payloadDigest))
      .find(
        (payload) =>
          typeof payload === "object" &&
          payload !== null &&
          "toolName" in payload &&
          "decision" in payload &&
          payload.toolName === "claim_reference" &&
          payload.decision === "allowed",
      );
    expect(reference).toMatchObject({ facts: { observations: 0 } });
    expect(JSON.stringify(reference)).toContain("gate-run");
    const claims = evidence
      .records()
      .filter((record) => record.type === "claim" && record.actor === "harness");
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((record) => record.provenance.includes("tool-output"))).toBe(true);
    expect(claims.map((record) => evidence.payloads().get(record.payloadDigest))).toContainEqual(
      expect.objectContaining({ recordKind: "gate-run:tests", predicate: 'status == "failed"' }),
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 20000);
