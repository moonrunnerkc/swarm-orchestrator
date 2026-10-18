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
/** One declare_planned_check call per check, each naming its requirement's words beside it. */
const declaring = (
  requirements: { id: string; description: string; quote?: string }[],
  checks: ReturnType<typeof plannedCheck>[],
) => ({
  toolCalls: checks.map((check) => {
    const requirement = requirements.find((one) => one.id === check.requirement);
    if (requirement === undefined) throw new Error(`no requirement ${check.requirement}`);
    return {
      name: "declare_planned_check",
      input: {
        ...check,
        requirementId: check.requirement,
        requirement: requirement.description,
        ...(requirement.quote === undefined ? {} : { quote: requirement.quote }),
      },
    };
  }),
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
        // Loads the project and never calls it: the base gets every case wrong, as the missing
        // change would, and only the control case it lacks would have shown that.
        plannedCheck(
          "uncontrolled",
          "boundary",
          "change",
          [
            { input: 9, expected: "small" },
            { input: 10, expected: "small" },
          ],
          "import { classify } from './value.mjs';\nexport default () => classify && null;\n",
        ),
        // Imports a module that does not exist: it never loads on the base.
        plannedCheck(
          "broken",
          "loads",
          "change",
          [
            { input: 9, expected: "small" },
            { input: 10, expected: "small" },
          ],
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

/**
 * The ordinary command line, with --plan-checks and (unless told otherwise) a supplied contract,
 * on a scripted model.
 */
async function swarm(
  turns: readonly ScriptedTurnSource[],
  built = false,
  extraArgs: readonly string[] = [],
  withContract = true,
  prepared: Promise<{ directory: string; base: string; contract: string }> = workspace(built),
  goal = task,
  planChecks = true,
): Promise<{ endpoint: ScriptedEndpoint; stdout: string; code: number }> {
  const endpoint = await startScriptedEndpoint({ modelId: "stub", turns });
  endpoints.push(endpoint);
  const { directory, base, contract } = await prepared;
  let stdout = "";
  let code = 0;
  try {
    const ran = await run(
      process.execPath,
      [
        resolve("src/cli.ts"),
        goal,
        "--model",
        "local:stub",
        "--local-endpoint",
        endpoint.url,
        "--workspace",
        directory,
        "--base",
        base,
        ...(withContract ? ["--goal-contract", contract] : []),
        ...(planChecks ? ["--plan-checks"] : []),
        "--approve",
        "auto",
        "--no-tui",
        "--no-open-evidence",
        "--json",
        ...extraArgs,
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
  bundleDirectory?: string;
  verdict?: { acceptable?: boolean; reasons?: Record<string, string> };
  outcome?: {
    status?: string;
    changedFiles?: string[];
    requirements?: {
      id: string;
      status: string;
      authoredBy: string;
      source?: string;
      generatedChecks?: { id: string; status: string }[];
    }[];
    uncheckedRequirements?: { id: string }[];
  };
  plannedChecks?: {
    outcome: string;
    admitted: string[];
    dropped: { check: string; reason: string }[];
    revision: { outcome: string } | null;
    coverage: {
      sentences: number;
      quotedByAdmitted: number[];
      quotedWithoutCheck?: number[];
    } | null;
  };
}

/** The bundle's own verifier, run as a reviewer runs it, with nothing installed. */
async function verifyBundle(directory: string): Promise<{ code: number; stdout: string }> {
  return run(process.execPath, [join(directory, "verify.mjs"), directory]).then(
    (ran) => ({ code: 0, stdout: ran.stdout }),
    (failed: { code?: number; stdout?: string }) => ({
      code: failed.code ?? 1,
      stdout: failed.stdout ?? "",
    }),
  );
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
    // The repaired change is what the task asks, and the supplied suite decides its requirement.
    // The planned requirements are hypotheses: their generated checks drove the repair and agree
    // with the result, and they decide nothing, so the supplied acceptance stands.
    expect(result?.outcome?.status, stdout.slice(-4000)).toBe("accepted");
    expect(result?.verdict?.acceptable).toBe(true);
    expect(code).toBe(0);
    // The bundled verifier re-derives the same reading: the supplied requirement is the only
    // obligation, and the hypotheses beside it in the contract carry none.
    const verified = await verifyBundle(result?.bundleDirectory ?? "");
    expect(verified.stdout).toContain("goal obligations");
    expect(verified.stdout).not.toMatch(/FAIL/);
    expect(verified.code).toBe(0);

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
    ).toEqual({
      boundary: true,
      above: true,
      mislabelled: false,
      uncontrolled: false,
      broken: false,
    });
    expect(admission?.decisions?.find((one) => one.check === "uncontrolled")).toMatchObject({
      broken: true,
      reason: expect.stringMatching(/gets every case wrong on the base/),
    });
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
          check: "uncontrolled",
          reason:
            "it gets every case wrong on the base, so nothing shows its program calls the project correctly; a change check also holds a case the task does not change, which the base gets right",
        },
        {
          check: "broken",
          reason:
            "it fails on the base without completing, which shows a broken check rather than the missing change",
        },
      ],
      revision: { outcome: "ran", admitted: [] },
      coverage: { sentences: 1, quotedByAdmitted: [1], quotedWithoutCheck: [] },
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

    // Sealed: the supplied requirement, decided by its check, and the planned ones, decided by
    // none. The planned requirement whose only check never loaded quotes the task, so it stays
    // sealed and visible with no check rather than vanishing with its check.
    expect(
      (result?.outcome?.requirements ?? []).map((one) => [
        one.id,
        one.status,
        one.authoredBy,
        one.source,
        one.generatedChecks?.map((check) => [check.id, check.status]) ?? null,
      ]),
    ).toEqual([
      ["suite", "accepted", "user", "supplied", null],
      ["boundary", "unjudged", "model", "planned", [["boundary", "accepted"]]],
      ["above", "unjudged", "model", "planned", [["above", "accepted"]]],
      ["loads", "unjudged", "model", "planned", []],
    ]);
    expect(result?.outcome?.uncheckedRequirements).toBeUndefined();
    expect(stdout).toMatch(/no check +loads: .*\[planned from the task/);
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
      coverage: null,
    });
    expect(code, stdout.slice(-3000)).toBe(0);
  }, 200_000);

  it("lets a repair rerun the check that refused it and probe the project without writing a file", async () => {
    const probe = "import { classify } from './value.mjs';\nexport default (n) => classify(n);\n";
    const { endpoint, stdout } = await swarm(
      [
        declaring(
          [
            { id: "boundary", description: "10 is small", quote },
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
          ],
        ),
        { text: "Pinned." },
        { text: "Plan: move the boundary.", toolCalls: [declare] },
        // Wrong: the boundary moved too far.
        {
          toolCalls: [
            write("export function classify(n) {\n  return n <= 20 ? 'small' : 'big';\n}\n"),
          ],
        },
        { text: "Done." },
        { toolCalls: [{ name: "run_check", input: { check: "above" } }] },
        { toolCalls: [{ name: "run_check", input: { program: probe, inputs: [10, 11, 21] } }] },
        {
          toolCalls: [
            write("export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n"),
          ],
        },
        { text: "Repaired." },
      ],
      false,
      ["--attempts", "1"],
    );

    const toolAnswers = endpoint.requests
      .map((request) => JSON.stringify(request))
      .filter((text) => text.includes("run_check"));
    const rerun = toolAnswers.find((text) => text.includes("case by case"));
    // The check exactly as the gate ran it, with the case that refused the change.
    expect(rerun, stdout.slice(-3000)).toContain("generated check above: rejected");
    expect(rerun).toMatch(
      /input 11: expected \{\\"input\\":11,\\"result\\":\\"big\\"\}; got \{\\"input\\":11,\\"result\\":\\"small\\"\} {2}<- differs/,
    );
    // The probe's own results, with no file written or left behind.
    const probed = toolAnswers.find((text) => text.includes("Your program over the project"));
    // The wrong candidate's own answers: 11 small, which is the fault, and 21 big.
    expect(probed).toContain('{\\"input\\":11,\\"result\\":\\"small\\"}');
    expect(probed).toContain('{\\"input\\":21,\\"result\\":\\"big\\"}');
    const result = resultOf(stdout);
    expect(result?.outcome?.status).toBe("accepted");
    expect(result?.outcome?.changedFiles).toEqual(["value.mjs"]);
    const { stdout: left } = await run("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: join(scratch, "workspace"),
    });
    expect(left.trim()).toBe("M value.mjs");
  }, 200_000);

  it("keeps a correct change that a wrong generated expectation disputes, and reports it unresolved, not refused", async () => {
    // The task keeps 11 big; the planner's check says 11 becomes small. The base gets 9 right and
    // 10 and 11 wrong, so the base control admits it: nothing there can tell its 11 is wrong.
    const correct = "export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n";
    const keepsTheCode: ScriptedTurnSource = (request) =>
      JSON.stringify(request).includes("These generated checks disagree with the change")
        ? { text: "The task keeps 11 big, so the expectation for 11 is wrong; the code stays." }
        : { text: "The brief did not say the check is the planner's reading." };
    const { stdout, code } = await swarm(
      [
        declaring(
          [{ id: "boundary", description: "10 is small", quote }],
          [
            plannedCheck("boundary", "boundary", "change", [
              { input: 9, expected: "small" },
              { input: 10, expected: "small" },
              { input: 11, expected: "small" },
            ]),
          ],
        ),
        { text: "Pinned." },
        { text: "Plan: move the boundary.", toolCalls: [declare] },
        { toolCalls: [write(correct)] },
        { text: "Done." },
        keepsTheCode,
      ],
      false,
      ["--attempts", "1"],
    );

    expect(stdout).toMatch(/admitted boundary \(should fail there\)/);
    const result = resultOf(stdout);
    expect(result?.outcome?.status, JSON.stringify(result?.verdict)).toBe("unresolved");
    expect(code).toBe(1);
    expect(
      result?.outcome?.requirements?.map((one) => [
        one.id,
        one.status,
        one.generatedChecks?.map((check) => check.status) ?? null,
      ]),
    ).toEqual([
      ["suite", "accepted", null],
      ["boundary", "unjudged", ["rejected"]],
    ]);
    // Not refused: no requirement is unmet, the outcome names the dispute, and the correct code
    // was not rewritten to fit the expectation.
    expect(stdout).not.toContain("UNMET");
    expect(stdout).toMatch(/outcome: unresolved \(a generated check disagrees/);
    expect(stdout).toMatch(/DISPUTED boundary: 10 is small/);
    expect(stdout).toContain("next: read the disputed requirement(s) boundary against the task");
    expect(readFileSync(join(scratch, "workspace", "value.mjs"), "utf8")).toBe(correct);
  }, 200_000);

  it("names a repair a wrong generated expectation alone asked for, when the repair gives in to it", async () => {
    // As above, but the repair makes 11 small to satisfy the planner's wrong expectation. Nothing
    // supplied covers 11, so the regression is delivered: what the outcome can do is say that this
    // change was made for a generated check alone, so it is not accepted silently.
    const correct = "export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n";
    const givesIn: ScriptedTurnSource = (request) =>
      JSON.stringify(request).includes("These generated checks disagree with the change")
        ? {
            toolCalls: [
              write("export function classify(n) {\n  return n <= 11 ? 'small' : 'big';\n}\n"),
            ],
          }
        : { text: "The brief did not say the check is the planner's reading." };
    const { stdout, code } = await swarm(
      [
        declaring(
          [{ id: "boundary", description: "10 is small", quote }],
          [
            plannedCheck("boundary", "boundary", "change", [
              { input: 9, expected: "small" },
              { input: 10, expected: "small" },
              { input: 11, expected: "small" },
            ]),
          ],
        ),
        { text: "Pinned." },
        { text: "Plan: move the boundary.", toolCalls: [declare] },
        { toolCalls: [write(correct)] },
        { text: "Done." },
        givesIn,
        { text: "Repaired." },
      ],
      false,
      ["--attempts", "1"],
    );

    const result = resultOf(stdout) as ResultLine & {
      outcome?: { repairsForGeneratedChecksOnly?: number[] };
    };
    // The supplied suite still decides, and passes: accepted, with the repair named.
    expect(result?.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(code).toBe(0);
    expect(result?.outcome?.repairsForGeneratedChecksOnly).toEqual([1]);
    expect(stdout).toContain(
      "repaired for generated checks alone: attempt(s) 1 changed the code when only a generated check disagreed",
    );
  }, 200_000);

  it("rolls back a repair that satisfies a generated check by breaking a supplied one", async () => {
    // Launch 3: a repair answered the generated check by breaking the supplied visible check.
    // Both were in one acceptance gate that was failing before and after, so the ratchet kept
    // the broken candidate. The generated checks now have their own gate, so breaking a supplied
    // check is a passing gate regressing, which the ratchet refuses.
    const prepared = (async () => {
      const ready = await workspace();
      await writeFile(
        ready.contract,
        JSON.stringify({
          version: 1,
          goal: task,
          requirements: [
            { id: "suite", description: "the project's suite passes", checks: ["suite"] },
            { id: "twelve", description: "12 stays big", checks: ["twelve"] },
          ],
          checks: [
            {
              id: "suite",
              command: "node --test",
              author: "user",
              exposure: "shared",
              artifacts: [],
            },
            {
              id: "twelve",
              command: "node twelve-check.mjs",
              author: "user",
              exposure: "shared",
              artifacts: [
                {
                  path: "twelve-check.mjs",
                  content:
                    "import { classify } from './value.mjs';\nif (classify(12) !== 'big') { console.error('classify(12) is ' + classify(12)); process.exit(1); }\n",
                },
              ],
            },
          ],
          immutablePaths: ["value.test.mjs", "twelve-check.mjs"],
        }),
      );
      return ready;
    })();
    const tooFar: ScriptedTurnSource = (request) =>
      JSON.stringify(request).includes("These generated checks disagree with the change")
        ? {
            toolCalls: [
              write("export function classify(n) {\n  return n <= 20 ? 'small' : 'big';\n}\n"),
            ],
          }
        : { text: "The brief named no generated check." };
    const right: ScriptedTurnSource = (request) =>
      JSON.stringify(request).includes("Gates it broke: task-acceptance")
        ? {
            toolCalls: [
              write("export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n"),
            ],
          }
        : { text: "The brief did not say what the rolled-back attempt broke." };
    const { stdout, code } = await swarm(
      [
        declaring(
          [{ id: "boundary", description: "10 is small", quote }],
          [
            plannedCheck("boundary", "boundary", "change", [
              { input: 9, expected: "small" },
              { input: 10, expected: "small" },
            ]),
          ],
        ),
        { text: "Pinned." },
        { text: "Plan: look at the boundary.", toolCalls: [declare] },
        {
          toolCalls: [
            write(
              "export function classify(n) {\n  return n < 10 ? 'small' : 'big'; // boundary\n}\n",
            ),
          ],
        },
        { text: "Done." },
        tooFar,
        { text: "Repaired." },
        right,
        { text: "Repaired." },
      ],
      false,
      [],
      true,
      prepared,
    );

    const result = resultOf(stdout);
    expect(result?.outcome?.status, stdout.slice(-4000)).toBe("accepted");
    expect(code).toBe(0);
    expect(readFileSync(join(scratch, "workspace", "value.mjs"), "utf8")).toContain("n <= 10");
    // Attempt 1 was refused for the supplied check it broke; attempt 2 is the delivered one.
    expect(stdout).toMatch(/task-diagnostics/);
  }, 200_000);

  it("rolls back a repair that breaks one supplied check while another was already failing", async () => {
    // The gate split above keeps generated checks apart from supplied ones. Within the supplied
    // checks the acceptance gate is still one verdict: with `ten` failing before and after, a
    // repair that also broke `twelve` left the gate failing exactly as before, so nothing the
    // ratchet compared had moved. Each supplied check is now held to the no-regression rule.
    const supplied = (id: string, n: number, want: string) => ({
      id,
      command: `node ${id}-check.mjs`,
      author: "user",
      exposure: "shared",
      artifacts: [
        {
          path: `${id}-check.mjs`,
          content: `import { classify } from './value.mjs';\nif (classify(${n}) !== '${want}') { console.error('classify(${n}) is ' + classify(${n})); process.exit(1); }\n`,
        },
      ],
    });
    const prepared = (async () => {
      const ready = await workspace();
      await writeFile(
        ready.contract,
        JSON.stringify({
          version: 1,
          goal: task,
          requirements: [
            { id: "suite", description: "the project's suite passes", checks: ["suite"] },
            { id: "ten", description: "10 is small", checks: ["ten"] },
            { id: "twelve", description: "12 stays big", checks: ["twelve"] },
          ],
          checks: [
            {
              id: "suite",
              command: "node --test",
              author: "user",
              exposure: "shared",
              artifacts: [],
            },
            supplied("ten", 10, "small"),
            supplied("twelve", 12, "big"),
          ],
          immutablePaths: ["value.test.mjs", "ten-check.mjs", "twelve-check.mjs"],
        }),
      );
      return ready;
    })();
    // Leaves 10 big, as before, and makes 12 small: one supplied check still failing, another newly so.
    const breaksTwelve: ScriptedTurnSource = (request) =>
      JSON.stringify(request).includes("check ten rejected")
        ? {
            toolCalls: [
              write(
                "export function classify(n) {\n  return n < 10 || n === 12 ? 'small' : 'big';\n}\n",
              ),
            ],
          }
        : { text: "The brief named no failing supplied check." };
    // Answers only when told the rolled-back attempt broke `twelve`.
    const right: ScriptedTurnSource = (request) => {
      const text = JSON.stringify(request);
      return text.includes("was rolled back") && text.includes("twelve")
        ? {
            toolCalls: [
              write("export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n"),
            ],
          }
        : { text: "The brief did not say the last attempt broke twelve." };
    };
    const { stdout, code } = await swarm(
      [
        { text: "Plan: look at the boundary.", toolCalls: [declare] },
        {
          toolCalls: [
            write("export function classify(n) {\n  return n < 10 ? 'small' : 'big';\n}\n"),
          ],
        },
        { text: "Done." },
        breaksTwelve,
        { text: "Repaired." },
        right,
        { text: "Repaired." },
      ],
      false,
      [],
      true,
      prepared,
      task,
      false,
    );

    const result = resultOf(stdout);
    expect(result?.outcome?.status, stdout.slice(-4000)).toBe("accepted");
    expect(code).toBe(0);
    expect(readFileSync(join(scratch, "workspace", "value.mjs"), "utf8")).toContain("n <= 10");
    // The bundle's own re-deriver reaches the same refusal from the recorded check results.
    const bundle = result?.bundleDirectory ?? "";
    expect((await verifyBundle(bundle)).code).toBe(0);
    const rederived = await run(process.execPath, [join(bundle, "rederive.mjs"), bundle]);
    expect(rederived.stdout).toMatch(
      /AGREES +ratchet-decision \d+ \(retry, attempt 1\): rejected, gate-part-regressed/,
    );
    expect(rederived.stdout).not.toMatch(/DISAGREES/);
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
              plannedCheck("boundary", "boundary", "change", [
                { input: 9, expected: "small" },
                { input: 10, expected: "small" },
              ]),
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
            [
              { input: 9, expected: "small" },
              { input: 10, expected: "small" },
            ],
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
    // The revision declared the reopened requirement again under its own id.
    expect(result?.outcome?.requirements?.map((one) => [one.id, one.status])).toEqual([
      ["suite", "accepted"],
      ["boundary", "unjudged"],
      ["above", "unjudged"],
    ]);
    expect(result?.plannedChecks?.revision).toEqual({
      outcome: "ran",
      admitted: ["boundary", "above"],
    });
    expect(result?.outcome?.status).toBe("accepted");
    expect(code).toBe(0);
  }, 200_000);

  it("lets the planner run its checks on the base inside its own loop, and admits what it finished on", async () => {
    const requirements = [{ id: "boundary", description: "10 is small", quote }];
    const good = plannedCheck("boundary", "boundary", "change", [
      { input: 9, expected: "small" },
      { input: 10, expected: "small" },
    ]);
    const trial = { toolCalls: [{ name: "run_planned_checks_on_base", input: {} }] };
    // Replaces the broken check only when the in-loop run reported why it never loaded.
    const replaces: ScriptedTurnSource = (request) =>
      JSON.stringify(request).includes("the check program did not load")
        ? declaring(requirements, [
            plannedCheck("loads", "boundary", "change", [
              { input: 9, expected: "small" },
              { input: 10, expected: "small" },
            ]),
          ])
        : { text: "The base run reported nothing to fix." };
    const { endpoint, stdout, code } = await swarm([
      declaring(requirements, [
        good,
        plannedCheck(
          "loads",
          "boundary",
          "change",
          [
            { input: 9, expected: "small" },
            { input: 10, expected: "small" },
          ],
          classifying("./missing.mjs"),
        ),
      ]),
      trial,
      replaces,
      trial,
      { text: "Pinned and checked on the base." },
      { text: "Plan: move the boundary.", toolCalls: [declare] },
      {
        toolCalls: [
          write("export function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n"),
        ],
      },
      { text: "Done." },
    ]);

    expect(code, stdout.slice(-3000)).toBe(0);
    expect(resultOf(stdout)?.outcome?.status).toBe("accepted");
    expect(stdout).toContain(
      "admission reuses the planner's own last base run of these exact checks",
    );
    expect(resultOf(stdout)?.plannedChecks).toMatchObject({
      outcome: "sealed",
      admitted: ["boundary", "loads"],
      dropped: [],
      revision: { outcome: "not-needed" },
    });
    // The second in-loop run saw both checks hold their control.
    expect(JSON.stringify(endpoint.requests)).toContain("Every check holds its base control");
    // And at that point it is asked what of the task its cases do not yet exercise.
    expect(JSON.stringify(endpoint.requests)).toContain(
      "reread each sentence of the task that states a rule",
    );
  }, 200_000);

  it("ends a run of the planner's hypotheses alone unjudged, exit 0, as the run without planning ends", async () => {
    const { stdout, code } = await swarm(
      [
        declaring(
          [{ id: "boundary", description: "10 is small", quote }],
          [
            plannedCheck("boundary", "boundary", "change", [
              { input: 9, expected: "small" },
              { input: 10, expected: "small" },
            ]),
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
      false,
      [],
      false,
    );

    const result = resultOf(stdout);
    // Nothing anyone authorized decided the task, and the generated check agrees: the gates
    // passed and the task was not judged, which is exit 0 with or without --plan-checks.
    expect(result?.outcome?.status, stdout.slice(-3000)).toBe("unjudged");
    expect(code).toBe(0);
    expect(result?.verdict?.acceptable).toBe(true);
    expect(stdout).toContain("No requirement was supplied, so nothing here judged the task");
    expect(result?.outcome?.requirements?.map((one) => [one.id, one.source, one.status])).toEqual([
      ["boundary", "planned", "unjudged"],
    ]);
    const verified = await verifyBundle(result?.bundleDirectory ?? "");
    expect(verified.stdout).not.toMatch(/FAIL/);
    expect(verified.code).toBe(0);
  }, 200_000);

  it("checks an equivalence the task states at every position, and repairs the one the first change missed", async () => {
    const slugTask =
      "make slug(text) treat a tab like a space: a space already separates words, and so must a tab";
    // Base: spaces separate words. The first change handles a lone tab and misses a tab beside a
    // space, which a single example ("a\tb") passes.
    const prepared = (async () => {
      const directory = join(scratch, "workspace");
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: "slugs",
          version: "1.0.0",
          type: "module",
          scripts: { test: "node --test" },
        }),
      );
      await writeFile(
        join(directory, "slug.mjs"),
        "export function slug(text) {\n  return text.trim().split(/ +/).join('-');\n}\n",
      );
      await writeFile(
        join(directory, "slug.test.mjs"),
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { slug } from './slug.mjs';\ntest('words', () => assert.equal(slug('a b'), 'a-b'));\n",
      );
      await git(directory, "init", "-q");
      await git(directory, "add", "-A");
      await git(directory, "commit", "-qm", "base");
      const contract = join(scratch, "contract.json");
      await writeFile(
        contract,
        JSON.stringify({
          version: 1,
          goal: slugTask,
          requirements: [
            { id: "suite", description: "the project's suite passes", checks: ["suite"] },
          ],
          checks: [
            {
              id: "suite",
              command: "node --test",
              author: "user",
              exposure: "shared",
              artifacts: [],
            },
          ],
          immutablePaths: ["slug.test.mjs"],
        }),
      );
      return { directory, base: await git(directory, "rev-parse", "HEAD"), contract };
    })();
    const writeSlug = (source: string) => ({
      name: "write",
      input: { path: "slug.mjs", content: source },
    });
    const repairOnRelation: ScriptedTurnSource = (request) => {
      const text = JSON.stringify(request);
      // Repairs only from the counterexample in words: the seed, the position and both answers.
      if (
        !text.includes("generated relation tab-like-space broke") ||
        !text.includes("at position 5")
      )
        return { text: "The repair brief named no counterexample." };
      return {
        toolCalls: [
          writeSlug(
            "export function slug(text) {\n  return text.trim().split(/[ \\t]+/).join('-');\n}\n",
          ),
        ],
      };
    };
    const { stdout, code } = await swarm(
      [
        {
          toolCalls: [
            {
              name: "declare_planned_relation",
              input: {
                id: "tab-like-space",
                purpose: "change",
                requirementId: "tab-separates",
                requirement: "a tab separates words as a space does",
                quote: "treat a tab like a space",
                program:
                  "import { slug } from './slug.mjs';\nexport default (text) => slug(text);\n",
                seeds: ["hello world"],
                reference: " ",
                variants: ["\t"],
                why: "the task says a tab is treated like a space",
              },
            },
          ],
        },
        { text: "Pinned." },
        {
          text: "Plan: split on tabs too.",
          toolCalls: [{ name: "declare_file_set", input: { files: ["slug.mjs"] } }],
        },
        {
          toolCalls: [
            writeSlug(
              "export function slug(text) {\n  return text.trim().split(/ +|\\t/).join('-');\n}\n",
            ),
          ],
        },
        { text: "Done." },
        repairOnRelation,
        { text: "Repaired." },
      ],
      false,
      [],
      true,
      prepared,
      slugTask,
    );

    const result = resultOf(stdout);
    expect(stdout).toMatch(/admitted tab-like-space \(should fail there\)/);
    expect(result?.outcome?.status, stdout.slice(-4000)).toBe("accepted");
    expect(code).toBe(0);
    expect(
      result?.outcome?.requirements?.find((one) => one.id === "tab-separates")?.generatedChecks,
    ).toEqual([expect.objectContaining({ id: "tab-like-space", status: "accepted" })]);
    const { stdout: source } = await run("git", ["diff"], { cwd: join(scratch, "workspace") });
    expect(source).toContain("split(/[ \\t]+/)");
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
              [
                { input: 9, expected: "small" },
                { input: 10, expected: "small" },
              ],
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
    expect(resultOf(stdout)?.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(code).toBe(0);
  }, 200_000);
});
