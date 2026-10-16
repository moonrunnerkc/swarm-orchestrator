import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ScriptedEndpoint,
  type ScriptedTurnSource,
  startScriptedEndpoint,
} from "./providers/scripted-endpoint.ts";

const run = promisify(execFile);

/**
 * Planned checks through the ordinary command line: a planner authors behavior checks from the
 * task before anything is implemented, each is admitted or dropped by what it does on the
 * unchanged base, the admitted ones join the supplied contract, and a worker whose first change
 * breaks one is repaired against the concrete mismatch. The model is scripted.
 */
let scratch = "";
let home = "";
const endpoints: ScriptedEndpoint[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-planned-checks-"));
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

const task = "make classify(n) call 10 small: every n up to and including 10 is small";

/** classify calls n < 10 small; the task moves the boundary, and 11 and above stay big. */
async function workspace(): Promise<{ directory: string; base: string; contract: string }> {
  const directory = join(scratch, "workspace");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "sized",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  await writeFile(
    join(directory, "value.mjs"),
    "export function classify(n) {\n  return n < 10 ? 'small' : 'big';\n}\n",
  );
  await writeFile(
    join(directory, "value.test.mjs"),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { classify } from './value.mjs';\ntest('three is small', () => assert.equal(classify(3), 'small'));\n",
  );
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-qm", "base");
  const contract = join(scratch, "contract.json");
  await writeFile(
    contract,
    JSON.stringify({
      version: 1,
      goal: task,
      requirements: [{ id: "suite", description: "the project's suite passes", checks: ["suite"] }],
      checks: [
        { id: "suite", command: "node --test", author: "user", exposure: "shared", artifacts: [] },
      ],
      immutablePaths: ["value.test.mjs"],
    }),
  );
  return { directory, base: await git(directory, "rev-parse", "HEAD"), contract };
}

/** A planned check: an inline script printing classify over fixed inputs, compared as one JSON line. */
function plannedCheck(id: string, atBase: "fails" | "passes", script: string, expected: string) {
  const argv = ["node", "--input-type=module", "-e", script];
  return {
    id,
    command: argv.join(" "),
    author: "model",
    exposure: "shared",
    atBase,
    artifacts: [],
    behavior: {
      kind: "cli",
      cwd: ".",
      timeoutMs: 10_000,
      maxOutputBytes: 4096,
      toolchain: "Node",
      network: "inherit",
      argv,
      exitCode: 0,
      stdout: [{ kind: "equals", value: expected }],
      stderr: [],
    },
  };
}

const printing = (inputs: number[]) =>
  `import { classify } from './value.mjs';\nconsole.log(JSON.stringify(Object.fromEntries(${JSON.stringify(inputs)}.map((n) => [n, classify(n)]))));`;

const plannerTurns: ScriptedTurnSource[] = [
  {
    text: "Plan: pin the boundary, what stays, and two checks that should not survive.",
    toolCalls: [
      {
        name: "declare_goal_contract",
        input: {
          version: 1,
          goal: task,
          requirements: [
            {
              id: "boundary",
              description: "10 is small, and so is everything below it",
              checks: ["boundary", "mislabelled", "broken"],
            },
            { id: "above", description: "11 and above stay big", checks: ["above"] },
          ],
          checks: [
            plannedCheck("boundary", "fails", printing([9, 10]), '{"9":"small","10":"small"}\n'),
            plannedCheck("above", "passes", printing([11, 50]), '{"11":"big","50":"big"}\n'),
            // Says it detects the change, yet the base already gets it right.
            plannedCheck("mislabelled", "fails", printing([3]), '{"3":"small"}\n'),
            // Imports a module that does not exist: it fails on the base without completing.
            plannedCheck("broken", "fails", "import './missing.mjs';", '{"10":"small"}\n'),
          ],
          immutablePaths: [],
        },
      },
    ],
  },
  { text: "Criteria pinned." },
];

const declare = { name: "declare_file_set", input: { files: ["value.mjs"] } };
const write = (source: string) => ({
  name: "write",
  input: { path: "value.mjs", content: source },
});

/** The repair turn, which answers only if the brief carries the planned check's mismatch. */
const repairs: ScriptedTurnSource = (request) => {
  const text = JSON.stringify(request);
  if (!text.includes("should equal") || !text.includes("above"))
    return { text: "The repair brief named no concrete failure." };
  return {
    toolCalls: [write("export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n")],
  };
};

describe("planned checks through the ordinary command line", () => {
  it("admits checks by their base control and repairs a change against the one it broke", async () => {
    const endpoint = await startScriptedEndpoint({
      modelId: "stub",
      turns: [
        ...plannerTurns,
        { text: "Plan: move the boundary.", toolCalls: [declare] },
        // Wrong: the boundary moved too far, which breaks "11 and above stay big".
        {
          toolCalls: [
            write("export function classify(n) {\n  return n <= 20 ? 'small' : 'big';\n}\n"),
          ],
        },
        { text: "Done." },
        repairs,
        { text: "Repaired." },
      ],
    });
    endpoints.push(endpoint);
    const { directory, base, contract } = await workspace();
    let stdout = "";
    let code = 0;
    try {
      stdout = (
        await run(
          process.execPath,
          [
            resolve("src/cli.ts"),
            task,
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
            "--plan-checks",
            "--approve",
            "auto",
            "--no-tui",
            "--no-open-evidence",
            "--json",
          ],
          {
            cwd: directory,
            env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" },
            timeout: 180_000,
          },
        )
      ).stdout;
    } catch (cause) {
      const failed = cause as { code?: number; stdout?: string; stderr?: string };
      code = failed.code ?? 1;
      stdout = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
    }

    const result = stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map(
        (line) =>
          JSON.parse(line) as {
            schema: string;
            runId?: string;
            verdict?: { acceptable?: boolean };
            outcome?: { requirements?: { id: string; status: string; authoredBy: string }[] };
          },
      )
      .find((line) => line.schema === "swarm.result.v1");
    expect(result?.verdict?.acceptable, stdout.slice(-4000)).toBe(true);
    expect(code).toBe(0);

    // The planning chain holds the admission: two admitted, two dropped, each with its reason.
    const planning = join(home, ".swarm", "sessions", `${result?.runId}-plan`);
    const admission = readFileSync(join(planning, "ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
      .filter((record) => record.type === "verification-command")
      .map(
        (record) =>
          JSON.parse(
            readFileSync(join(planning, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"),
          ) as {
            rule?: string;
            decisions?: { check: string; admitted: boolean; reason: string }[];
          },
      )
      .find((payload) => payload.rule === "planned-check-admission-v1");
    expect(
      Object.fromEntries((admission?.decisions ?? []).map((one) => [one.check, one.admitted])),
    ).toEqual({ boundary: true, above: true, mislabelled: false, broken: false });
    expect(admission?.decisions?.find((one) => one.check === "broken")?.reason).toContain(
      "without completing",
    );

    // Sealed: the supplied requirement and the two planned ones that kept a check.
    expect(
      (result?.outcome?.requirements ?? []).map((one) => [one.id, one.status, one.authoredBy]),
    ).toEqual([
      ["suite", "accepted", "user"],
      ["boundary", "accepted", "model"],
      ["above", "accepted", "model"],
    ]);
    // The repair turn was asked, and with the concrete mismatch: it is the turn that wrote the fix.
    expect(endpoint.played()).toBe(7);
  }, 200_000);
});
