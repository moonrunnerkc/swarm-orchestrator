import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { createFixedRandom } from "../core/test-doubles.ts";
import { bundleSourceFromRecorder, exportBundle } from "../evidence/bundle.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { createEphemeralSigningKey } from "../evidence/signing.ts";
import { parseTaskContract } from "../evidence/task-contract.ts";
import { verifyBundle } from "../evidence/verifier/verify.mjs";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import { runInParallel } from "./parallel-run.ts";
import { contractsFromGraph } from "./task-contract.ts";
import { readTaskGraph } from "./task-graph.ts";

const git = promisify(execFile);
const clock = createSystemClock();
let scratch = "";
let repository = "";

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-contract-runtime-"));
  repository = join(scratch, "repo");
  await mkdir(repository);
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
  );
  await writeFile(
    join(repository, "base.test.js"),
    'import {test} from "node:test"; import assert from "node:assert/strict"; test("base", () => assert.equal(1 + 1, 2));\n',
  );
  await writeFile(
    join(repository, "mutate.js"),
    'import {writeFileSync} from "node:fs"; writeFileSync("forbidden.js", "export const forbidden = 1;\\n");\n',
  );
  await git("git", ["init", "-q", repository]);
  await git("git", ["-C", repository, "add", "."]);
  await git("git", [
    "-C",
    repository,
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-qm",
    "base",
  ]);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function execute(
  turns: readonly FixtureTurn[],
  options: { required?: string; network?: "denied" | "mediated"; tools?: readonly string[] } = {},
) {
  const graph = readTaskGraph({
    goal: "authorized task",
    nodes: [
      {
        id: "task",
        title: "task",
        instruction: "authorized task",
        files: ["allowed.js"],
        acceptance: options.required === undefined ? [] : [options.required],
      },
    ],
  });
  const contract = parseTaskContract({
    ...contractsFromGraph(graph, {
      maxSteps: 8,
      maxWallMs: 60_000,
      immutablePaths: ["base.test.js"],
    })[0],
    ...(options.network === undefined ? {} : { network: options.network }),
    ...(options.tools === undefined ? {} : { allowedTools: options.tools }),
  });
  const coordinator = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "queue",
    clock,
  });
  let modelCalls = 0;
  const offered: string[][] = [];
  const briefs: string[] = [];
  const outcome = await runInParallel({
    repositoryRoot: repository,
    baseRef: "HEAD",
    tasks: ["authorized task"],
    runId: "contract",
    scratchRoot: join(scratch, "trees"),
    coordinator,
    createWorkerSession: (workerId) =>
      openEvidenceSession({ root: join(scratch, "sessions"), sessionId: workerId, clock }),
    createModel: () => {
      const fixture = createFixtureModelClient({ modelId: "fixture:contract", turns });
      return {
        modelId: fixture.modelId,
        generate: (request) => {
          modelCalls += 1;
          offered.push(request.tools.map((tool) => tool.name));
          briefs.push(
            ...request.messages
              .filter((message) => message.role === "user")
              .map((message) => message.text),
          );
          return fixture.generate(request);
        },
      };
    },
    graph,
    contracts: [contract],
    clock,
    random: createFixedRandom(),
    emit: () => {},
    maxSteps: 8,
    attempts: 0,
    redundancy: 1,
    concurrency: 1,
    modelSpec: "fixture:contract",
    abortSignal: new AbortController().signal,
    gateOptions: {
      commandOverrides: { special: { command: 'node -e "process.exit(1)"', severity: "advisory" } },
    },
  });
  return { outcome, modelCalls, offered, briefs };
}

const declare = respondWithToolCalls("scope", [
  { callId: "declare", toolName: "declare_file_set", input: { files: ["allowed.js"] } },
]);

describe("task contracts through public parallel execution", () => {
  it("shows the exact effective permissions before the first worker call", async () => {
    const { briefs } = await execute([respondWithText("done")]);
    expect(briefs[0]).toContain('"writable":["allowed.js"]');
    expect(briefs[0]).toContain('"immutable":["base.test.js"]');
    expect(briefs[0]).toContain("declarations cannot enlarge this authority");
  });
  it("executes a graph-required check and refuses its advisory failure", async () => {
    const { outcome } = await execute([respondWithText("done")], { required: "special" });
    expect(outcome.workers[0]?.green).toBe(false);
    const evidence = outcome.workers[0]?.evidence;
    const assessment = [...(evidence?.payloads().values() ?? [])].find(
      (payload) => typeof payload === "object" && payload !== null && "inputs" in payload,
    );
    expect(assessment).toMatchObject({
      inputs: { policy: "run-acceptance-v2", requiredChecks: ["special"] },
      verdict: { acceptable: false },
    });
    expect(outcome.workers[0]?.commit).toBeNull();
    if (evidence === undefined) throw new Error("worker produced no evidence");
    const destination = join(scratch, "contract-bundle");
    await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination,
      signingKey: createEphemeralSigningKey(),
      clock,
    });
    const messages: string[] = [];
    expect(
      verifyBundle(destination, (line: string) => messages.push(line)),
      messages.join("\n"),
    ).toBe(0);
    const forged = await openEvidenceSession({
      root: join(scratch, "sessions"),
      sessionId: "forged",
      clock,
    });
    for (const entry of evidence.records()) {
      const payload = evidence.payloads().get(entry.payloadDigest);
      if (payload === undefined) throw new Error("missing original payload");
      const changed = JSON.parse(JSON.stringify(payload));
      if (entry.type === "run-assessment") {
        changed.inputs.requiredChecks = [];
        changed.verdict.acceptable = true;
      }
      await forged.record({
        type: entry.type,
        actor: entry.actor,
        provenance: entry.provenance,
        payload: changed,
      });
    }
    const forgedDestination = join(scratch, "forged-bundle");
    await exportBundle({
      source: bundleSourceFromRecorder(forged),
      destination: forgedDestination,
      signingKey: createEphemeralSigningKey(),
      clock,
    });
    const refusals: string[] = [];
    expect(verifyBundle(forgedDestination, (line: string) => refusals.push(line))).not.toBe(0);
    expect(refusals.join("\n")).toContain("run assessment");
  });

  it("refuses undefined required checks before asking a model", async () => {
    const { outcome, modelCalls } = await execute([respondWithText("done")], {
      required: "missing",
    });
    expect(modelCalls).toBe(0);
    expect(outcome.workers[0]?.detail).toContain("requires undefined checks: missing");
  });

  it.each(["denied", "mediated"] as const)(
    "does not pretend the host enforces %s networking",
    async (network) => {
      const { outcome, modelCalls } = await execute([respondWithText("done")], { network });
      expect(modelCalls).toBe(0);
      expect(outcome.workers[0]?.green).toBe(false);
      expect(outcome.workers[0]?.detail).toContain("cannot be dispatched");
    },
  );

  it("cannot enlarge scope by declaring or amending its own registry", async () => {
    const { outcome } = await execute([
      declare,
      respondWithToolCalls("widen", [
        {
          callId: "widen",
          toolName: "amend_file_set",
          input: { files: ["forbidden.js"], reason: "worker wants it" },
        },
      ]),
      respondWithText("done"),
    ]);
    const evidence = outcome.workers[0]?.evidence;
    expect(evidence?.records().some((entry) => entry.type === "file-set-amended")).toBe(false);
    expect(JSON.stringify([...(evidence?.payloads().values() ?? [])])).toContain(
      "outside controller-authorized scope",
    );
  });

  it("refuses shell effects outside scope in the post-execution gates", async () => {
    const { outcome } = await execute([
      declare,
      respondWithToolCalls("shell effect", [
        { callId: "shell", toolName: "shell", input: { command: "node mutate.js" } },
      ]),
      respondWithText("done"),
    ]);
    expect(outcome.workers[0]?.green).toBe(false);
    expect(outcome.workers[0]?.detail).toContain("file-set");
  });

  it("constructs only the workspace tools permitted by the effective contract", async () => {
    const { offered } = await execute([respondWithText("done")], { tools: ["read"] });
    expect(offered[0]).toContain("read");
    expect(offered[0]).not.toContain("shell");
    expect(offered[0]).not.toContain("write");
    expect(offered[0]).not.toContain("read_trail");
  });
});
