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
async function workspace(
  built = false,
): Promise<{ directory: string; base: string; contract: string }> {
  const directory = join(scratch, "workspace");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "sized",
      version: "1.0.0",
      type: "module",
      // A project whose consumers import what its build writes, as mime's import dist/.
      scripts: built
        ? { build: "mkdir -p built && cp value.mjs built/value.mjs", test: "node --test" }
        : { test: "node --test" },
    }),
  );
  if (built) await writeFile(join(directory, ".gitignore"), "built/\n");
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

/** A planned check as the planner declares it: a program over classify, and its cases. */
function plannedCheck(
  id: string,
  requirement: string,
  purpose: "change" | "preserve",
  cases: { input: number; expected: string }[],
  program = classifying("./value.mjs"),
) {
  return { id, requirement, purpose, program, cases, why: "the task states the boundary" };
}

const classifying = (path: string) =>
  `import { classify } from '${path}';\nexport default (n) => classify(n);\n`;
const quote = "every n up to and including 10 is small";
const declaring = (requirements: unknown[], checks: unknown[]) => ({
  toolCalls: [{ name: "declare_planned_checks", input: { requirements, checks } }],
});

/** Every brief the planner was sent, as text, for what it carried. */
const plannerBriefs = (endpoint: ScriptedEndpoint) =>
  endpoint.requests
    .map((request) => JSON.stringify(request))
    .filter((text) => text.includes("You write the acceptance checks"));

const plannerTurns: ScriptedTurnSource[] = [
  {
    text: "Plan: pin the boundary, what stays, and two checks that should not survive.",
    ...declaring(
      [
        { id: "boundary", description: "10 is small, and so is everything below it", quote },
        { id: "loads", description: "the module loads from its own path", quote },
        { id: "above", description: "11 and above stay big" },
      ],
      [
        plannedCheck("boundary", "boundary", "change", [
          { input: 9, expected: "small" },
          { input: 10, expected: "small" },
        ]),
        plannedCheck("above", "above", "preserve", [
          { input: 11, expected: "big" },
          { input: 50, expected: "big" },
        ]),
        // Says it detects the change, yet the base already gets it right.
        plannedCheck("mislabelled", "boundary", "change", [{ input: 3, expected: "small" }]),
        // Imports a module that does not exist: it never loads on the base.
        plannedCheck(
          "broken",
          "loads",
          "change",
          [{ input: 10, expected: "small" }],
          classifying("./missing.mjs"),
        ),
      ],
    ),
  },
  { text: "Criteria pinned." },
];

const declare = { name: "declare_file_set", input: { files: ["value.mjs"] } };
const write = (source: string) => ({
  name: "write",
  input: { path: "value.mjs", content: source },
});

/** The repair turn, which answers only if the brief carries the planned check's line that differed. */
const repairs: ScriptedTurnSource = (request) => {
  const text = JSON.stringify(request);
  if (!text.includes("line 1 should be") || !text.includes("above"))
    return { text: "The repair brief named no concrete failure." };
  return {
    toolCalls: [write("export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n")],
  };
};

/** The ordinary command line, with a supplied contract and --plan-checks, on a scripted model. */
async function swarm(
  turns: readonly ScriptedTurnSource[],
  built = false,
): Promise<{ endpoint: ScriptedEndpoint; stdout: string; code: number }> {
  const endpoint = await startScriptedEndpoint({ modelId: "stub", turns });
  endpoints.push(endpoint);
  const { directory, base, contract } = await workspace(built);
  let stdout = "";
  let code = 0;
  try {
    const ran = await run(
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
    );
    stdout = `${ran.stdout}\n${ran.stderr}`;
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    code = failed.code ?? 1;
    stdout = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
  }
  return { endpoint, stdout, code };
}

interface ResultLine {
  schema: string;
  runId?: string;
  verdict?: { acceptable?: boolean };
  outcome?: {
    requirements?: { id: string; status: string; authoredBy: string }[];
    uncheckedRequirements?: { id: string }[];
  };
  plannedChecks?: {
    outcome: string;
    admitted: string[];
    dropped: { check: string; reason: string }[];
    revision: { outcome: string } | null;
  };
}

const resultOf = (stdout: string) =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as ResultLine)
    .find((line) => line.schema === "swarm.result.v1");

describe("planned checks through the ordinary command line", () => {
  it("admits checks by their base control and repairs a change against the one it broke", async () => {
    const { endpoint, stdout, code } = await swarm([
      ...plannerTurns,
      // The revision round for the two dropped checks: the planner replaces nothing.
      { text: "No replacement." },
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
    ]);

    const result = resultOf(stdout);
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
            decisions?: { check: string; admitted: boolean; reason: string; broken: boolean }[];
          },
      )
      .find((payload) => payload.rule === "planned-check-admission-v1");
    expect(
      Object.fromEntries((admission?.decisions ?? []).map((one) => [one.check, one.admitted])),
    ).toEqual({ boundary: true, above: true, mislabelled: false, broken: false });
    expect(admission?.decisions?.find((one) => one.check === "broken")?.broken).toBe(true);
    expect(result?.plannedChecks).toEqual({
      outcome: "sealed",
      admitted: ["boundary", "above"],
      dropped: [
        {
          check: "mislabelled",
          reason: "it passes on the base, so it does not detect the requested change",
        },
        {
          check: "broken",
          reason:
            "it fails on the base without completing, which shows a broken check rather than the missing change",
        },
      ],
      revision: { outcome: "ran", admitted: [] },
    });

    // The revision brief carried the load failure and the program it came from, and not the base
    // results of the change check the base already satisfies, which would only invite fitting them.
    const revisionBrief = plannerBriefs(endpoint).find((text) =>
      text.includes("Declare replacements"),
    );
    expect(revisionBrief).toContain("the check program did not load");
    expect(revisionBrief).toContain("./missing.mjs");
    // Each dropped check's inputs as read, so a planner can see what the harness received.
    expect(revisionBrief).toContain("inputs as read: 3");
    expect(revisionBrief).not.toMatch(/mislabelled[^-]*on the base:/);

    // Sealed: the supplied requirement and the two planned ones that kept a check. The planned
    // requirement whose only check never loaded is named as unchecked, not sealed and not met.
    expect(
      (result?.outcome?.requirements ?? []).map((one) => [one.id, one.status, one.authoredBy]),
    ).toEqual([
      ["suite", "accepted", "user"],
      ["boundary", "accepted", "model"],
      ["above", "accepted", "model"],
    ]);
    expect(result?.outcome?.uncheckedRequirements?.map((one) => one.id)).toEqual(["loads"]);
    expect(stdout).toMatch(/unchecked loads: .*not sealed or judged/);
    // The repair turn was asked, and with the line that differed: it is the turn that wrote the fix.
    expect(endpoint.played()).toBe(8);
    // Planning's spend is on the machine stream with the implementation's and the repair's, where
    // a launcher sums the stopped events: planning, its revision, implementation and repair.
    const stops = stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as { event?: { type?: string; tokensUsed?: number } })
      .filter((line) => line.event?.type === "stopped");
    expect(stops).toHaveLength(4);
    expect(stops.every((stop) => (stop.event?.tokensUsed ?? 0) > 0)).toBe(true);
  }, 200_000);

  it("goes on against the supplied contract when the planner adds nothing, and says so on the result", async () => {
    const { stdout, code } = await swarm([
      { text: "I cannot pin checks for this." },
      { text: "Plan: move the boundary.", toolCalls: [declare] },
      {
        toolCalls: [
          write("export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n"),
        ],
      },
      { text: "Done." },
    ]);

    expect(stdout).toContain("no planned check was added");
    expect(stdout).toContain("implementing against the supplied contract");
    expect(resultOf(stdout)?.plannedChecks).toEqual({
      outcome: "unresolved",
      admitted: [],
      dropped: [],
      revision: null,
    });
    expect(code, stdout.slice(-3000)).toBe(0);
  }, 200_000);

  it("revises a check that never loaded and a preserved case the base contradicts, from what each did there", async () => {
    // Answers only when its brief carries the load failure and the preserved case's base result.
    const revises: ScriptedTurnSource = (request) => {
      const text = JSON.stringify(request);
      return text.includes("the check program did not load") &&
        text.includes("line 1 should be") &&
        text.includes("but was")
        ? declaring(
            [
              { id: "boundary", description: "10 is small", quote },
              { id: "above", description: "11 and above stay big" },
            ],
            [
              plannedCheck("boundary", "boundary", "change", [{ input: 10, expected: "small" }]),
              plannedCheck("above", "above", "preserve", [{ input: 11, expected: "big" }]),
            ],
          )
        : { text: "The revision brief carried no base output." };
    };
    const { stdout, code } = await swarm([
      declaring(
        [
          { id: "boundary", description: "10 is small", quote },
          { id: "above", description: "11 and above stay big" },
        ],
        [
          plannedCheck(
            "boundary",
            "boundary",
            "change",
            [{ input: 10, expected: "small" }],
            classifying("./built/value.mjs"),
          ),
          // A misreading of what the base already does: 11 is big there.
          plannedCheck("above", "above", "preserve", [{ input: 11, expected: "small" }]),
        ],
      ),
      { text: "Pinned." },
      revises,
      { text: "Replaced." },
      { text: "Plan: move the boundary.", toolCalls: [declare] },
      {
        toolCalls: [
          write("export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n"),
        ],
      },
      { text: "Done." },
    ]);

    expect(stdout).toContain("revising the planned checks admission dropped");
    expect(stdout).toMatch(/admitted boundary \(should fail there\)/);
    expect(stdout).toMatch(/admitted above \(should pass there\)/);
    const result = resultOf(stdout);
    expect(result?.outcome?.requirements?.map((one) => [one.id, one.status])).toEqual([
      ["suite", "accepted"],
      ["boundary", "accepted"],
      ["above", "accepted"],
    ]);
    expect(result?.plannedChecks?.revision).toEqual({
      outcome: "ran",
      admitted: ["boundary", "above"],
    });
    expect(code).toBe(0);
  }, 200_000);

  it("admits a check of built output, because the base runs the project's build first as acceptance does", async () => {
    const { endpoint, stdout, code } = await swarm(
      [
        declaring(
          [{ id: "built-boundary", description: "10 is small", quote }],
          [
            plannedCheck(
              "built-boundary",
              "built-boundary",
              "change",
              [{ input: 10, expected: "small" }],
              classifying("./built/value.mjs"),
            ),
          ],
        ),
        { text: "Pinned." },
        { text: "Plan: move the boundary.", toolCalls: [declare] },
        {
          toolCalls: [
            write("export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n"),
          ],
        },
        { text: "Done." },
      ],
      true,
    );

    expect(stdout).toMatch(/admitted built-boundary \(should fail there\)/);
    expect(stdout).not.toContain("revising the planned checks");
    // The planner was told what the harness prepares, from the run's own configuration.
    expect(plannerBriefs(endpoint)[0]).toMatch(/fresh checkout of the unchanged base.*build/);
    expect(code, stdout.slice(-3000)).toBe(0);
  }, 200_000);
});
