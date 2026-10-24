import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ScriptedEndpoint,
  type ScriptedTurn,
  startScriptedEndpoint,
} from "./providers/scripted-endpoint.ts";

const run = promisify(execFile);

/**
 * The budgets a goal-contract run actually runs under, read back from its own sealed record and
 * its event stream after driving the ordinary command line with a scripted model: the token
 * allowance a launcher names stands when the contract names none, a smaller one binds, a call
 * whose usage was never reported is counted as unknown rather than as zero, and the wall the
 * implementation gets leaves the final verification its reserve inside the run's deadline.
 */
let scratch = "";
let home = "";
const endpoints: ScriptedEndpoint[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-goal-budgets-"));
  home = join(scratch, "home");
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) await endpoint.close();
  await rm(scratch, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
  });
  return ran.stdout.trim();
}

/**
 * A workspace whose sealed check passes once value.mjs exports 2, and the contract that seals it.
 * `slowCheckMs` makes the sealed check wait that long first, as a slow acceptance suite would.
 */
async function goalWorkspace(
  slowCheckMs = 0,
): Promise<{ directory: string; base: string; contract: string }> {
  const directory = join(scratch, "workspace");
  await mkdir(join(directory, "acceptance"), { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "budgets",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  await writeFile(join(directory, "value.mjs"), "export const value = 1;\n");
  await writeFile(
    join(directory, "value.test.mjs"),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from './value.mjs';\ntest('is a number', () => assert.equal(typeof value, 'number'));\n",
  );
  await writeFile(
    join(directory, "acceptance", "check.mjs"),
    `${slowCheckMs > 0 ? `await new Promise((wait) => setTimeout(wait, ${slowCheckMs}));\n` : ""}import { value } from '../value.mjs';\nif (value !== 2) { console.error('value is ' + value); process.exit(1); }\n`,
  );
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-qm", "base");
  const contract = join(scratch, "contract.json");
  await writeFile(
    contract,
    JSON.stringify({
      version: 1,
      goal: "make value equal 2",
      requirements: [{ id: "value", description: "value is 2", checks: ["check"] }],
      checks: [
        {
          id: "check",
          command: "node acceptance/check.mjs",
          author: "user",
          exposure: "shared",
          artifacts: [],
        },
      ],
      immutablePaths: ["acceptance"],
    }),
  );
  return { directory, base: await git(directory, "rev-parse", "HEAD"), contract };
}

const delivers: ScriptedTurn[] = [
  {
    text: "Plan: set the value.",
    toolCalls: [{ name: "declare_file_set", input: { files: ["value.mjs"] } }],
  },
  {
    toolCalls: [
      { name: "write", input: { path: "value.mjs", content: "export const value = 2;\n" } },
    ],
  },
  { text: "The value is 2." },
];

async function swarm(
  turns: readonly ScriptedTurn[],
  flags: readonly string[],
  workspace: { readonly slowCheckMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string; events: unknown[]; spec: SealedSpec }> {
  const endpoint = await startScriptedEndpoint({ modelId: "stub", turns });
  endpoints.push(endpoint);
  const { directory, base, contract } = await goalWorkspace(workspace.slowCheckMs);
  const args = [
    resolve("src/cli.ts"),
    "make value equal 2",
    "--model",
    "local:stub",
    "--local-endpoint",
    endpoint.url,
    "--workspace",
    directory,
    "--base",
    base,
    "--goal-contract",
    contract,
    "--approve",
    "auto",
    "--no-tui",
    "--no-open-evidence",
    "--json",
    ...flags,
  ];
  const env = { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" };
  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    const ran = await run(process.execPath, args, { cwd: directory, env, timeout: 180_000 });
    stdout = ran.stdout;
    stderr = ran.stderr;
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    code = failed.code ?? 1;
    stdout = failed.stdout ?? "";
    stderr = failed.stderr ?? "";
  }
  const lines = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { schema: string; runId?: string; event?: unknown });
  const result = lines.find((line) => line.schema === "swarm.result.v1");
  if (result?.runId === undefined) throw new Error(`no result line:\n${stdout}\n${stderr}`);
  return {
    code,
    stdout,
    stderr,
    events: lines.filter((line) => line.schema === "swarm.event.v1").map((line) => line.event),
    spec: sealedSpec(result.runId),
  };
}

interface SealedSpec {
  readonly budgets: { maxSteps: number; attempts: number; maxWallMs: number; maxTokens: number };
}

/** The run spec the run sealed on its own chain before its first model call. */
function sealedSpec(sessionId: string): SealedSpec {
  const directory = join(home, ".swarm", "sessions", sessionId);
  const records = readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; payloadDigest: string });
  const sealed = records.find((record) => record.type === "run-spec-sealed");
  if (sealed === undefined) throw new Error(`${sessionId} sealed no run spec`);
  const payload = JSON.parse(
    readFileSync(join(directory, "blobs", `${sealed.payloadDigest.slice(7)}.json`), "utf8"),
  ) as { spec: SealedSpec };
  return payload.spec;
}

const stopped = (events: unknown[]) =>
  events.filter((event) => (event as { type?: string }).type === "stopped") as {
    reason: string;
    tokensUsed: number;
    callsWithUnknownUsage?: number;
  }[];

describe("the budgets a goal-contract run runs under", () => {
  it("seals the launcher's 8,000,000-token allowance where the contract names no token budget", async () => {
    const ran = await swarm(delivers, ["--max-tokens", "8000000"]);
    expect(ran.code).toBe(0);
    // The contract default used to stand in for the contract's silence and seal 1,000,000.
    expect(ran.spec.budgets.maxTokens).toBe(8_000_000);
    // The documented product limits stand where nothing names others.
    expect(ran.spec.budgets.maxSteps).toBe(40);
    expect(ran.spec.budgets.attempts).toBe(3);
  });

  it("binds a smaller allowance and stops on it before the next prompt would cross it", async () => {
    const reading = { toolCalls: [{ name: "list", input: {} }] };
    const spend = { promptTokens: 400, completionTokens: 10 };
    const ran = await swarm(
      Array.from({ length: 6 }, () => ({ ...reading, usage: spend })),
      ["--max-tokens", "1000"],
    );
    expect(ran.spec.budgets.maxTokens).toBe(1000);
    const first = stopped(ran.events)[0];
    expect(first?.reason).toBe("max-tokens");
    // Two calls (820) leave less than the last prompt's size, so no third call is made.
    expect(first?.tokensUsed).toBe(820);
    expect(ran.code).not.toBe(0);
  });

  it("counts a call whose usage the endpoint never reported as unknown, not as zero", async () => {
    const [plan, write, finish] = delivers;
    const ran = await swarm([plan, { ...write, usage: null }, finish] as ScriptedTurn[], [
      "--max-tokens",
      "8000000",
    ]);
    const loop = stopped(ran.events)[0];
    expect(loop?.callsWithUnknownUsage).toBe(1);
  });

  it("gives the implementation the wall less the final verification's reserve", async () => {
    const ran = await swarm(delivers, ["--max-tokens", "8000000", "--max-wall-minutes", "3"]);
    // Three minutes, less the reserve the run keeps for the final verification (a quarter of the
    // total here, 45 seconds, since the policy's minute is more than a quarter), the backstop's
    // second and the moments spent before the spec is sealed.
    expect(ran.spec.budgets.maxWallMs).toBeLessThanOrEqual(134_000);
    expect(ran.spec.budgets.maxWallMs).toBeGreaterThan(120_000);
  });
});

/** The payload of every record of one type on a run's chain, in order. */
function chainPayloads(sessionId: string, type: string): Record<string, unknown>[] {
  const directory = join(home, ".swarm", "sessions", sessionId);
  return readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
    .filter((record) => record.type === type)
    .map(
      (record) =>
        JSON.parse(
          readFileSync(join(directory, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"),
        ) as Record<string, unknown>,
    );
}

const resultLine = (stdout: string) =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          schema: string;
          runId: string;
          outcome?: {
            status?: string;
            lifecycle?: string;
            finalVerification?: { refusal: string | null } | null;
          };
        },
    )
    .find((line) => line.schema === "swarm.result.v1");

/**
 * The verification reserve inside one total allowance, through the ordinary command line: a minute
 * in all, a quarter of it held for the final checks. The worker writes the change and then never
 * answers again, so it spends all the model work it is given.
 */
describe("the final checks' share of the total allowance", () => {
  const spendsItsAllowance: ScriptedTurn[] = [
    ...delivers.slice(0, 2),
    { text: "still thinking", delayMs: 120_000 },
  ];

  it("runs the required checks on the exact delivered tree after the worker spends its allocation", async () => {
    const ran = await swarm(spendsItsAllowance, [
      "--max-tokens",
      "8000000",
      "--max-wall-minutes",
      "1",
    ]);
    const runId = (resultLine(ran.stdout)?.runId ?? "") as string;
    const [reserve] = chainPayloads(runId, "session-budget").filter(
      (one) => one.rule === "verification-reserve-v1",
    );
    expect(reserve).toMatchObject({ reserveMs: 15_000, basis: "cap", capMs: 15_000 });
    expect(stopped(ran.events)[0]?.reason).toBe("max-wall-time");
    const gates = chainPayloads(runId, "gate-run");
    const tests = gates.filter((one) => one.gateId === "tests");
    expect(tests.at(-1)).toMatchObject({ status: "passed" });
    expect(JSON.stringify(gates)).not.toContain("refused before spawn");
    expect(gates.filter((one) => one.gateId === "task-acceptance").at(-1)).toMatchObject({
      status: "passed",
    });
    // The final independent verification applied the delivered patch and accepted the sealed check.
    const diff = chainPayloads(runId, "workspace-diff").at(-1) as { patch: string };
    expect(diff.patch).toContain("+export const value = 2;");
    const outcome = resultLine(ran.stdout)?.outcome;
    expect(outcome?.finalVerification?.refusal ?? null).toBeNull();
    // The model's work was cut at the end of its share, before the deadline, with its write long
    // settled; the delivered tree's required checks then completed and passed. The checks decide
    // the run, under the sealed contract's scope, and the lifecycle stays the cut: the model made
    // no completion claim and none is read. Until run-acceptance-v5 the cut alone refused it.
    expect(outcome?.lifecycle).toBe("max-wall-time");
    expect(outcome?.status).toBe("accepted");
    expect(ran.code).toBe(0);
    const [worker, goal] = chainPayloads(runId, "run-assessment") as {
      inputs: Record<string, unknown>;
      verdict: { acceptable: boolean; reasons: Record<string, string> };
    }[];
    expect(worker?.inputs).toMatchObject({
      policy: "run-acceptance-v6",
      lifecycle: "max-wall-time",
      wallStop: { beforeDeadline: true, effectsSettled: true },
    });
    expect(goal?.verdict.acceptable).toBe(true);
    expect(goal?.verdict.reasons.lifecycle).toContain("before the run's deadline");
    expect(ran.stdout + ran.stderr).not.toContain("the run was cancelled");
    // The call the cut ended was sent and never answered: its usage is unknown, not zero.
    expect(stopped(ran.events)[0]?.callsWithUnknownUsage).toBe(1);
  }, 200_000);

  it("stops a check slower than the reserve at the end of the total, and reports the run incomplete", async () => {
    const ran = await swarm(
      spendsItsAllowance,
      ["--max-tokens", "8000000", "--max-wall-minutes", "1"],
      {
        slowCheckMs: 25_000,
      },
    );
    const result = resultLine(ran.stdout);
    expect(result?.outcome?.status).toBe("not-accepted");
    const gates = chainPayloads(result?.runId ?? "", "gate-run");
    const acceptance = gates.filter((one) => one.gateId === "task-acceptance").at(-1);
    expect(acceptance?.status).not.toBe("passed");
    expect(JSON.stringify(gates) + ran.stdout + ran.stderr).toContain(
      "the run's total allowance ended before final verification finished",
    );
  }, 200_000);
});

describe("cancelling a goal run", () => {
  it("stops the run and its checks, and the result says it was cancelled", async () => {
    const endpoint = await startScriptedEndpoint({
      modelId: "stub",
      turns: [...delivers.slice(0, 2), { text: "still thinking", delayMs: 120_000 }],
    });
    endpoints.push(endpoint);
    const { directory, base, contract } = await goalWorkspace();
    const child = spawn(
      process.execPath,
      [
        resolve("src/cli.ts"),
        "make value equal 2",
        "--model",
        "local:stub",
        "--local-endpoint",
        endpoint.url,
        "--workspace",
        directory,
        "--base",
        base,
        "--goal-contract",
        contract,
        "--approve",
        "auto",
        "--no-tui",
        "--no-open-evidence",
        "--json",
        "--max-wall-minutes",
        "5",
      ],
      { cwd: directory, env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" } },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    const exited = new Promise<number>((settle) => child.on("exit", (code) => settle(code ?? -1)));
    // Cancel once the worker's third call, the one that never answers, is in flight.
    while (endpoint.requests.length < 3) await new Promise((wait) => setTimeout(wait, 100));
    child.kill("SIGINT");
    const code = await exited;
    expect(code).not.toBe(0);
    const result = resultLine(stdout);
    expect(result?.outcome?.status).toBe("not-accepted");
    const gates = chainPayloads(result?.runId ?? "", "gate-run");
    expect(gates.filter((one) => one.gateId === "tests").at(-1)).toMatchObject({
      status: "not-applicable",
    });
    expect(JSON.stringify(gates)).toContain("the run was cancelled from the keyboard");
  }, 200_000);
});
