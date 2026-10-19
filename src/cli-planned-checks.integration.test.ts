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

/**
 * A planned check as the planner declares it: a program over classify, and its cases. A change
 * check's case is marked changed where the base (n < 10 is small) gives something else, unless
 * the case says otherwise.
 */
function plannedCheck(
  id: string,
  requirement: string,
  purpose: "change" | "preserve",
  cases: { input: number; expected: string; changed?: boolean }[],
  program = classifying("./value.mjs"),
) {
  return {
    id,
    requirement,
    purpose,
    program,
    cases:
      purpose === "change"
        ? cases.map((one) => ({
            ...one,
            changed: one.changed ?? one.expected !== (one.input < 10 ? "small" : "big"),
          }))
        : cases,
    why: "the task states the boundary",
  };
}

/** A coverage review of one requirement that gives no relation, as a numeric rule has none. */
const reviewing = (requirementId: string, distinguishedBy: readonly string[] = []) => ({
  name: "declare_coverage_review",
  input: {
    id: `${requirementId}-review`,
    requirementId,
    change: "the boundary the task states",
    keeps: "everything the task does not name",
    wrongImplementation: "a boundary moved one step too far",
    distinguishedBy,
    noRelation: "the rule is about numbers, not text behaving like other text",
    untested: "none",
  },
});

const classifying = (path: string) =>
  `import { classify } from '${path}';\nexport default (n) => classify(n);\n`;
const quote = "every n up to and including 10 is small";
/** One declare_planned_check call per check, each naming its requirement's words beside it. */
const declaring = (
  requirements: { id: string; description: string; quote?: string }[],
  checks: ReturnType<typeof plannedCheck>[],
) => ({
  toolCalls: [
    ...declarations(requirements, checks),
    ...requirements.map((one) =>
      reviewing(
        one.id,
        checks.filter((check) => check.requirement === one.id).map((check) => check.id),
      ),
    ),
  ],
});
const declarations = (
  requirements: { id: string; description: string; quote?: string }[],
  checks: ReturnType<typeof plannedCheck>[],
) =>
  checks.map((check) => {
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
        plannedCheck("mislabelled", "boundary", "change", [
          { input: 3, expected: "small", changed: true },
        ]),
        // Loads the project and never calls it: the base gets every case wrong, as the missing
        // change would, and its kept case is what shows that.
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

/** What one gate wrote to stderr on each attempt of a run, read from the run's own chain. */
function gateStderr(runId: string | undefined, gateId: string): readonly string[] {
  const session = join(home, ".swarm", "sessions", runId ?? "");
  return readFileSync(join(session, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
    .filter((record) => record.type === "gate-run")
    .map(
      (record) =>
        JSON.parse(
          readFileSync(join(session, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"),
        ) as { gateId?: string; stderr?: string },
    )
    .filter((payload) => payload.gateId === gateId)
    .map((payload) => payload.stderr ?? "");
}

/** The payload of every record of one type on a run's own chain, in order. */
function chainPayloads(
  runId: string | undefined,
  type: string,
): readonly Record<string, unknown>[] {
  const session = join(home, ".swarm", "sessions", runId ?? "");
  return readFileSync(join(session, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
    .filter((record) => record.type === type)
    .map(
      (record) =>
        JSON.parse(
          readFileSync(join(session, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"),
        ) as Record<string, unknown>,
    );
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

/**
 * Base: spaces separate words. A first change that handles a lone tab and misses a tab beside a
 * space passes a single example ("a\tb").
 */
async function slugWorkspace(
  slugTask: string,
): Promise<{ directory: string; base: string; contract: string }> {
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
      requirements: [{ id: "suite", description: "the project's suite passes", checks: ["suite"] }],
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
}

const writeSlug = (source: string) => ({
  name: "write",
  input: { path: "slug.mjs", content: source },
});

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
      .find((payload) => payload.rule === "planned-check-admission-v2");
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
      broken: false,
      finding: "expectation-contradicted",
      reason: expect.stringMatching(/case\(s\) 1 are declared kept \(changed: false\)/),
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
            "case(s) 1 are declared kept (changed: false), so the unchanged base must give their expected results, and it does not: either the task changes them (changed: true, with the task's words in why) or the expectation misreads what the base does",
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
    // The planner's program, as the harness calls it, and what its expected results rest on.
    expect(rerun).toContain(
      "program (the planner's; the harness calls its default export once per case with that case's input itself)",
    );
    expect(rerun).toContain("export default (n) => classify(n);");
    expect(rerun).toContain(
      "expected results: what the unchanged base gave when the check was admitted",
    );
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
    // The review the first turn declared is acknowledged, not asked for again.
    expect(JSON.stringify(endpoint.requests)).toContain(
      "Coverage review: every requirement has one",
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
    const prepared = slugWorkspace(slugTask);
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
            {
              name: "declare_coverage_review",
              input: {
                id: "tab-review",
                requirementId: "tab-separates",
                change: "a tab separates words",
                keeps: "a space separates words",
                wrongImplementation: "split on a lone tab and miss one beside a space",
                distinguishedBy: ["tab-like-space"],
                noRelation: "the rule is declared as the relation tab-like-space",
                untested: "none",
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

  it("enumerates the relation a coverage review gives over an example check's program, with no relation tool called", async () => {
    const slugTask =
      "make slug(text) treat a tab like a space: a space already separates words, and so must a tab";
    const adapter = "import { slug } from './slug.mjs';\nexport default (text) => slug(text);\n";
    const repairs: ScriptedTurnSource = (request) =>
      JSON.stringify(request).includes("generated relation tab-anywhere broke") &&
      JSON.stringify(request).includes("at position 5")
        ? {
            toolCalls: [
              writeSlug(
                "export function slug(text) {\n  return text.trim().split(/[ \\t]+/).join('-');\n}\n",
              ),
            ],
          }
        : { text: "The repair brief named no counterexample." };
    const { endpoint, stdout, code } = await swarm(
      [
        {
          toolCalls: [
            {
              name: "declare_planned_check",
              input: {
                id: "tab-examples",
                purpose: "change",
                requirementId: "tab-separates",
                requirement: "a tab separates words as a space does",
                quote: "treat a tab like a space",
                program: adapter,
                cases: [
                  { input: "a b", expected: "a-b", changed: false },
                  { input: "a\tb", expected: "a-b", changed: true },
                ],
                why: "the task's own rule",
              },
            },
            {
              name: "declare_coverage_review",
              input: {
                id: "tab-anywhere",
                requirementId: "tab-separates",
                change: "a tab separates words",
                keeps: "a space separates words",
                wrongImplementation: "split on a lone tab and miss one beside a space",
                distinguishedBy: ["tab-anywhere"],
                relation: {
                  purpose: "change",
                  programFrom: "tab-examples",
                  seeds: ["hello world"],
                  reference: "U+0020",
                  variants: ["U+0009"],
                },
                untested: "tabs at the very ends, which trim removes",
              },
            },
          ],
        },
        { text: "Pinned." },
        {
          text: "Plan: split on tabs too.",
          toolCalls: [{ name: "declare_file_set", input: { files: ["slug.mjs"] } }],
        },
        // Passes the example and misses a tab beside a space.
        {
          toolCalls: [
            writeSlug(
              "export function slug(text) {\n  return text.trim().split(/ +|\\t/).join('-');\n}\n",
            ),
          ],
        },
        { text: "Done." },
        repairs,
        { text: "Repaired." },
      ],
      false,
      [],
      true,
      slugWorkspace(slugTask),
      slugTask,
    );

    expect(stdout).toMatch(/admitted tab-anywhere \(should fail there\)/);
    expect(stdout).toMatch(/admitted tab-examples \(should fail there\)/);
    expect(resultOf(stdout)?.outcome?.status, stdout.slice(-4000)).toBe("accepted");
    expect(code).toBe(0);
    // No call ever named the relation tool: the review's relation is what ran.
    expect(
      endpoint.requests.some((request) =>
        JSON.stringify(request).includes('"name":"declare_planned_relation","arguments"'),
      ),
    ).toBe(false);
    const { stdout: source } = await run("git", ["diff"], { cwd: join(scratch, "workspace") });
    expect(source).toContain("split(/[ \\t]+/)");
  }, 200_000);

  it("rolls back a repair that breaks a generated relation that held, to satisfy a wrong changed case", async () => {
    // Ordinary launch O1's shape: the first change is right and the relation holds; one changed
    // case the task does not support ("a\t" gives "a-") fails. The repair told only that case
    // satisfies it by breaking the relation. The relation is a part of the diagnostics gate, so
    // the ratchet refuses that repair and the right first change is what remains.
    const slugTask =
      "make slug(text) treat a tab like a space: a space already separates words, and so must a tab";
    const adapter = "import { slug } from './slug.mjs';\nexport default (text) => slug(text);\n";
    const breaksRelation: ScriptedTurnSource = (request) =>
      JSON.stringify(request).includes("slug-examples rejected")
        ? {
            toolCalls: [
              writeSlug(
                "export function slug(text) {\n  return text.replace(/^ +| +$/g, '').split(/[ \\t]+/).join('-');\n}\n",
              ),
            ],
          }
        : { text: "The repair brief named no failing case." };
    const { stdout } = await swarm(
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
                program: adapter,
                seeds: ["hello world"],
                reference: "U+0020",
                variants: ["U+0009"],
                why: "the task says a tab is treated like a space",
              },
            },
            {
              name: "declare_planned_check",
              input: {
                id: "slug-examples",
                purpose: "change",
                requirementId: "tab-separates",
                requirement: "a tab separates words as a space does",
                quote: "treat a tab like a space",
                program: adapter,
                cases: [
                  { input: "a b", expected: "a-b", changed: false },
                  { input: "a\tb", expected: "a-b", changed: true },
                  { input: "a\t", expected: "a-", changed: true },
                ],
                why: "the planner's reading, the last case wrong",
              },
            },
            {
              name: "declare_coverage_review",
              input: {
                id: "tab-review",
                requirementId: "tab-separates",
                change: "a tab separates words",
                keeps: "a space separates words",
                wrongImplementation: "split on a lone tab only",
                distinguishedBy: ["tab-like-space"],
                noRelation: "declared as the relation tab-like-space",
                untested: "none",
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
              "export function slug(text) {\n  return text.trim().split(/[ \\t]+/).join('-');\n}\n",
            ),
          ],
        },
        { text: "Done." },
        breaksRelation,
        { text: "Repaired." },
        { text: "The task does not say a trailing tab leaves a dash; I leave the code." },
        { text: "Still nothing to change." },
        { text: "Nothing more." },
      ],
      false,
      [],
      true,
      slugWorkspace(slugTask),
      slugTask,
    );

    const result = resultOf(stdout);
    const session = join(home, ".swarm", "sessions", result?.runId ?? "");
    const decisions = readFileSync(join(session, "ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
      .filter((record) => record.type === "ratchet-decision")
      .map(
        (record) =>
          JSON.parse(
            readFileSync(join(session, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8"),
          ) as { attempt: number; accepted: boolean; detail: string },
      );
    expect(
      decisions.find((one) => one.attempt === 1),
      stdout.slice(-4000),
    ).toMatchObject({
      accepted: false,
      detail: expect.stringContaining("tab-like-space in the task-diagnostics gate passed before"),
    });
    // The relation failed on the base, so it is the planner's claim; it is still held here,
    // since the repair restored nothing the base or a supplied check backs.
    const diagnostics = chainPayloads(result?.runId, "gate-run").filter(
      (one) => one.gateId === "task-diagnostics",
    );
    expect(
      diagnostics.map((one) => (JSON.parse(String(one.stdout)) as { claims?: string[] }).claims),
    ).toEqual(diagnostics.map(() => ["tab-like-space"]));
    const { stdout: source } = await run("git", ["diff"], { cwd: join(scratch, "workspace") });
    expect(source).toContain("text.trim().split(/[ \\t]+/)");
    expect(result?.outcome?.status).toBe("unresolved");
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

/**
 * A lookup whose answer for anything it cannot read is null, as launch 5's project answered null
 * for undefined. The task makes it ignore letter case; words it does not know stay null.
 */
const lookupTask =
  "Make kindOf ignore letter case: kindOf('Apple') must give 'fruit', as kindOf('apple') already does. Words it does not know stay null.";
const lookupQuote = "Make kindOf ignore letter case";
const lookupSource = (key: string) =>
  [
    "export class Lookup {",
    "  #table;",
    "  constructor(entries = {}) {",
    "    this.#table = new Map(Object.entries(entries));",
    "  }",
    "  kindOf(word) {",
    "    if (typeof word !== 'string') return null;",
    `    return this.#table.get(${key}) ?? null;`,
    "  }",
    "}",
    "export default new Lookup({ apple: 'fruit', carrot: 'vegetable' });",
    "",
  ].join("\n");

async function lookupWorkspace(): Promise<{ directory: string; base: string; contract: string }> {
  const directory = join(scratch, "workspace");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "lookup",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  await writeFile(join(directory, "lookup.mjs"), lookupSource("word"));
  await writeFile(
    join(directory, "lookup.test.mjs"),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport lookup from './lookup.mjs';\ntest('apple is a fruit', () => assert.equal(lookup.kindOf('apple'), 'fruit'));\n",
  );
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-qm", "base");
  const contract = join(scratch, "contract.json");
  await writeFile(
    contract,
    JSON.stringify({
      version: 1,
      goal: lookupTask,
      requirements: [{ id: "suite", description: "the project's suite passes", checks: ["suite"] }],
      checks: [
        { id: "suite", command: "node --test", author: "user", exposure: "shared", artifacts: [] },
      ],
      immutablePaths: ["lookup.test.mjs"],
    }),
  );
  return { directory, base: await git(directory, "rev-parse", "HEAD"), contract };
}

/** What the base lookup answers: exact words only. */
const lookupAtBase = (word: unknown) =>
  typeof word === "string" ? ({ apple: "fruit", carrot: "vegetable" }[word] ?? null) : null;

/**
 * One declare_planned_check call over the lookup, under the case requirement. A string case is
 * marked changed where the base lookup answers something else, unless the case says otherwise.
 */
const lookupCheck = (
  id: string,
  program: string,
  cases: { input: unknown; expected: unknown; changed?: boolean }[],
  purpose: "change" | "preserve" = "change",
) => ({
  name: "declare_planned_check",
  input: {
    id,
    purpose,
    requirementId: "case",
    requirement: "kindOf ignores letter case",
    quote: lookupQuote,
    program,
    cases:
      purpose === "change"
        ? cases.map((one) => ({
            ...one,
            changed: one.changed ?? one.expected !== lookupAtBase(one.input),
          }))
        : cases,
    why: "the task states the rule and its example",
  },
});
const lookupReview = {
  name: "declare_coverage_review",
  input: {
    id: "case-review",
    requirementId: "case",
    change: "kindOf ignores letter case",
    keeps: "unknown words stay null; exact words keep their kind",
    wrongImplementation: "lower only the first letter",
    distinguishedBy: [],
    noRelation: "the rule is about letter case, which no text substitution expresses",
    untested: "words with letters outside ASCII",
  },
};
const adapter =
  "import lookup from './lookup.mjs';\nexport default function run(word) {\n  return lookup.kindOf(word);\n}\n";
const lookupFix = {
  toolCalls: [
    { name: "declare_file_set", input: { files: ["lookup.mjs"] } },
    { name: "write", input: { path: "lookup.mjs", content: lookupSource("word.toLowerCase()") } },
  ],
};

/** isPositive answers false for every input: the defect is one answer for everything. */
async function signWorkspace(): Promise<{ directory: string; base: string; contract: string }> {
  const directory = join(scratch, "workspace");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "sign",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  await writeFile(
    join(directory, "sign.mjs"),
    "export function isPositive(n) {\n  return false;\n}\n",
  );
  await writeFile(
    join(directory, "sign.test.mjs"),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { isPositive } from './sign.mjs';\ntest('zero is not positive', () => assert.equal(isPositive(0), false));\n",
  );
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-qm", "base");
  const contract = join(scratch, "contract.json");
  await writeFile(
    contract,
    JSON.stringify({
      version: 1,
      goal: signTask,
      requirements: [{ id: "suite", description: "the project's suite passes", checks: ["suite"] }],
      checks: [
        { id: "suite", command: "node --test", author: "user", exposure: "shared", artifacts: [] },
      ],
      immutablePaths: ["sign.test.mjs"],
    }),
  );
  return { directory, base: await git(directory, "rev-parse", "HEAD"), contract };
}
const signTask = "Make isPositive return true for positive numbers and false otherwise.";

describe("what admission accepts as a generated check's control", () => {
  it("holds a changed expectation the repair left as it was, stops repair there, and leaves the run unresolved", async () => {
    // Launch 4's shape: a correct change, and one generated case the task does not support (13
    // small) marked changed. The repair is told it once; it leaves the code, and the case gives
    // the same answer, so it is held: no further attempt is spent and the correct change stays.
    const { stdout, code } = await swarm(
      [
        declaring(
          [{ id: "boundary", description: "10 is small", quote }],
          [
            plannedCheck("boundary", "boundary", "change", [
              { input: 9, expected: "small" },
              { input: 10, expected: "small" },
              { input: 12, expected: "big" },
              { input: 13, expected: "small", changed: true },
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
        { text: "The task keeps 13 big, so I leave the code as it is." },
        { text: "A second repair was asked for." },
      ],
      false,
      [],
    );

    const result = resultOf(stdout) as ResultLine & {
      outcome?: { interventions?: { repairAttempts?: number } };
    };
    expect(result?.plannedChecks?.admitted, stdout.slice(-4000)).toEqual(["boundary"]);
    expect(result?.outcome?.interventions?.repairAttempts).toBe(1);
    // Told once, with the case's role; held on the next reading, which asks for no change.
    const readings = gateStderr(result?.runId, "task-diagnostics");
    expect(readings[0]).toContain("case(s) 4 are the planner's reading of the change");
    expect(readings.at(-1)).toContain(
      "generated check boundary is held: case(s) 4 were told to a repair on this very tree and give what they gave",
    );
    expect(stdout).not.toContain("A second repair was asked for.");
    // The stop is the held expectation's, never a checking-program defect's.
    expect(
      chainPayloads(result?.runId, "session-stopped").filter(
        (one) => one.stopReason === "repair-unavailable",
      ),
    ).toEqual([expect.objectContaining({ classification: "held-expectation" })]);
    expect(result?.outcome?.status, stdout.slice(-6000)).toBe("unresolved");
    expect(
      result?.outcome?.requirements?.find((one) => one.id === "boundary")?.generatedChecks,
    ).toEqual([expect.objectContaining({ id: "boundary", status: "rejected" })]);
    const { stdout: source } = await run("git", ["diff"], { cwd: join(scratch, "workspace") });
    expect(source).toContain("n <= 10");
    expect(code).toBe(1);
  }, 200_000);

  it("keeps asking a repair that changed the code but has not yet moved a changed case, and accepts the second change", async () => {
    // A valid expectation (10 small) whose repair takes two changes: the first adds a switch for
    // the boundary and leaves it off, so the case still answers big though the code changed. An
    // unchanged answer is not the expectation shown wrong, so the case is not held and the second
    // repair, which turns the switch on, is asked for.
    const step = (inclusive: boolean) =>
      write(
        `const limit = 10;\nconst inclusive = ${inclusive};\nexport function classify(n) {\n  return n < limit || (inclusive && n === limit) ? 'small' : 'big';\n}\n`,
      );
    const { stdout, code } = await swarm(
      [
        declaring(
          [{ id: "boundary", description: "10 is small", quote }],
          [
            plannedCheck("boundary", "boundary", "change", [
              { input: 9, expected: "small" },
              { input: 10, expected: "small" },
              { input: 12, expected: "big" },
            ]),
          ],
        ),
        { text: "Pinned." },
        { text: "Plan: name the boundary first.", toolCalls: [declare] },
        {
          toolCalls: [
            write(
              "const limit = 10;\nexport function classify(n) {\n  return n < limit ? 'small' : 'big';\n}\n",
            ),
          ],
        },
        { text: "Done." },
        { toolCalls: [step(false)] },
        { text: "The switch is in; it is still off." },
        { toolCalls: [step(true)] },
        { text: "The boundary is inclusive now." },
      ],
      false,
      [],
    );

    const result = resultOf(stdout) as ResultLine & {
      outcome?: { interventions?: { repairAttempts?: number } };
    };
    expect(result?.plannedChecks?.admitted, stdout.slice(-4000)).toEqual(["boundary"]);
    const readings = gateStderr(result?.runId, "task-diagnostics");
    // After the first repair the case gives what it gave, on a changed tree: reported, not held.
    expect(readings[1]).toContain("case(s) 2 are the planner's reading of the change");
    expect(readings.join("\n")).not.toContain("is held");
    expect(result?.outcome?.interventions?.repairAttempts).toBe(2);
    expect(result?.outcome?.status, stdout.slice(-6000)).toBe("accepted");
    expect(code).toBe(0);
  }, 200_000);

  it("bounds repeated code changes against a wrong expectation and leaves the run unresolved", async () => {
    // A wrong changed case (13 small) the task does not support. Each repair changes the code:
    // one rewrites it without moving the answer, one satisfies the case by breaking 12 (rolled
    // back), one rewrites it again. None is held, since each changed the code; the attempt cap
    // stops it, and the run is unresolved with the correct boundary in place.
    const { stdout, code } = await swarm(
      [
        declaring(
          [{ id: "boundary", description: "10 is small", quote }],
          [
            plannedCheck("boundary", "boundary", "change", [
              { input: 9, expected: "small" },
              { input: 10, expected: "small" },
              { input: 12, expected: "big" },
              { input: 13, expected: "small", changed: true },
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
        {
          toolCalls: [
            write(
              "// Ten is the last small number.\nexport function classify(n) {\n  return n <= 10 ? 'small' : 'big';\n}\n",
            ),
          ],
        },
        { text: "Rewritten." },
        {
          toolCalls: [
            write("export function classify(n) {\n  return n <= 13 ? 'small' : 'big';\n}\n"),
          ],
        },
        { text: "Thirteen is small now." },
        {
          toolCalls: [
            write(
              "const last = 10;\nexport function classify(n) {\n  return n <= last ? 'small' : 'big';\n}\n",
            ),
          ],
        },
        { text: "Rewritten again." },
        { text: "A fourth repair was asked for." },
      ],
      false,
      [],
    );

    const result = resultOf(stdout) as ResultLine & {
      outcome?: { interventions?: { repairAttempts?: number } };
    };
    expect(result?.plannedChecks?.admitted, stdout.slice(-4000)).toEqual(["boundary"]);
    expect(gateStderr(result?.runId, "task-diagnostics").join("\n")).not.toContain("is held");
    const decisions = chainPayloads(result?.runId, "ratchet-decision").filter(
      (one) => one.scope === "retry",
    );
    expect(decisions.map((one) => [one.attempt, one.accepted])).toEqual([
      [1, true],
      [2, false],
      [3, true],
    ]);
    expect(result?.outcome?.interventions?.repairAttempts).toBe(3);
    expect(stdout).not.toContain("A fourth repair was asked for.");
    expect(
      chainPayloads(result?.runId, "session-stopped").filter(
        (one) => one.stopReason === "repair-unavailable",
      ),
    ).toEqual([]);
    expect(result?.outcome?.status, stdout.slice(-6000)).toBe("unresolved");
    const { stdout: source } = await run("git", ["diff"], { cwd: join(scratch, "workspace") });
    expect(source).toContain("n <= last");
    expect(code).toBe(1);
  }, 200_000);

  it("drops a program that takes each input for the case, naming the argument's shape, and admits its revision", async () => {
    // Launch 5's sealed programs called run(case_) and passed case_.input, undefined for a string
    // input, to a project that answers null to undefined; their null-expecting cases held on the
    // base. The probe, in a run of its own, saw the read; the planner sees why, and its revision
    // is admitted.
    const wrapped =
      "import lookup from './lookup.mjs';\nexport default function run(case_) {\n  return lookup.kindOf(case_.input);\n}\n";
    const revises: ScriptedTurnSource = (request) =>
      JSON.stringify(request).includes("called with each case's input itself")
        ? {
            toolCalls: [
              lookupCheck("case-rule", adapter, [
                { input: "Apple", expected: "fruit" },
                { input: "apple", expected: "fruit" },
                { input: "pear", expected: null },
              ]),
              lookupReview,
            ],
          }
        : { text: "The revision brief did not say what the program is called with." };
    const { endpoint, stdout, code } = await swarm(
      [
        {
          toolCalls: [
            lookupCheck("case-rule", wrapped, [
              { input: "Apple", expected: "fruit" },
              { input: "pear", expected: null },
            ]),
            lookupReview,
          ],
        },
        { text: "Pinned." },
        revises,
        { text: "Revised." },
        { text: "Plan: lower the word before the lookup.", ...lookupFix },
        { text: "Done." },
      ],
      false,
      [],
      true,
      lookupWorkspace(),
      lookupTask,
    );

    expect(stdout).toMatch(
      /dropped +case-rule \(should fail there\): its program read a field of the value it was called with/,
    );
    // The planner's revision brief carries what the probe saw, with the input as it was given,
    // and says what the probe is.
    expect(plannerBriefs(endpoint).at(-1)).toContain('input itself, \\"Apple\\", a string');
    expect(plannerBriefs(endpoint).at(-1)).toContain("seen by a separate diagnostic run");
    const result = resultOf(stdout);
    expect(result?.plannedChecks?.admitted, stdout.slice(-4000)).toEqual(["case-rule"]);
    expect(result?.outcome?.status).toBe("accepted");
    expect(
      result?.outcome?.requirements?.find((one) => one.id === "case")?.generatedChecks,
    ).toEqual([expect.objectContaining({ id: "case-rule", status: "accepted" })]);
    expect(code).toBe(0);
  }, 200_000);

  it("refuses a program that reads a case field and copes without it where its every answer is one value, saying why, and admits its revision", async () => {
    // Unknown words stay null, so a preservation of them answers null throughout, legitimately.
    // Its program reads word.input and falls back to the word itself, a valid program. On these
    // cases no answer tells it from launch 5's program, which passed undefined: the project
    // answers null both ways, and would also with the field given. Only tracing the project's
    // calls could, which the probe does not do. So it is refused, the reason says the fallback is
    // not told apart, and its revision, which takes the input, is admitted.
    const copes =
      "import lookup from './lookup.mjs';\nexport default (word) => lookup.kindOf(word.input ?? word);\n";
    const unknownWords = (program: string) =>
      lookupCheck(
        "unknown-words",
        program,
        [
          { input: "pear", expected: null },
          { input: "banana", expected: null },
        ],
        "preserve",
      );
    // The revision round's request: the dropped check, revised to take the input.
    const revises = { toolCalls: [unknownWords(adapter), lookupReview] };
    const { stdout, code } = await swarm(
      [
        { toolCalls: [unknownWords(copes), lookupReview] },
        { text: "Pinned." },
        revises,
        { text: "Revised." },
        { text: "Plan: lower the word before the lookup.", ...lookupFix },
        { text: "Done." },
      ],
      false,
      [],
      true,
      lookupWorkspace(),
      lookupTask,
    );

    expect(stdout).toMatch(
      /dropped +unknown-words \(should pass there\): its program read a field/,
    );
    expect(stdout).toContain(
      "nothing here tells the two apart and the check is refused rather than trusted",
    );
    const result = resultOf(stdout);
    expect(result?.plannedChecks?.admitted, stdout.slice(-4000)).toEqual(["unknown-words"]);
    expect(result?.outcome?.status).toBe("accepted");
    expect(code).toBe(0);
  }, 200_000);

  it("keeps programs whose answers are one value with their control unestablished, and holds them once the repair leaves them", async () => {
    // An empty fixture, a call to a method the project does not have and an imported project the
    // program never calls all answer null for every input, as a defect that answers one value
    // would. Nothing on the base tells those apart, so each is kept and reported, not refused;
    // on the fix they still answer null, the repair is told once, and then they are held.
    const emptyFixture =
      "import { Lookup } from './lookup.mjs';\nconst lookup = new Lookup();\nexport default (word) => lookup.kindOf(word);\n";
    const wrongCall =
      "import lookup from './lookup.mjs';\nexport default (word) => lookup.typeOf?.(word) ?? null;\n";
    const ignoredImport = "import lookup from './lookup.mjs';\nexport default (word) => null;\n";
    const cases = [
      { input: "Apple", expected: "fruit" },
      { input: "pear", expected: null },
    ];
    const { stdout, code } = await swarm(
      [
        {
          toolCalls: [
            lookupCheck("empty-fixture", emptyFixture, cases),
            lookupCheck("wrong-call", wrongCall, cases),
            lookupCheck("ignored-import", ignoredImport, cases),
            lookupReview,
          ],
        },
        { text: "Pinned." },
        { text: "Plan: lower the word before the lookup.", ...lookupFix },
        { text: "Done." },
        { text: "The project gives fruit for Apple now; these checks do not reach it." },
        { text: "A second repair was asked for." },
      ],
      false,
      [],
      true,
      lookupWorkspace(),
      lookupTask,
    );

    const result = resultOf(stdout) as ResultLine & {
      outcome?: { interventions?: { repairAttempts?: number } };
    };
    expect(result?.plannedChecks?.admitted, stdout.slice(-4000)).toEqual([
      "empty-fixture",
      "wrong-call",
      "ignored-import",
    ]);
    expect(result?.plannedChecks?.dropped).toEqual([]);
    const held = gateStderr(result?.runId, "task-diagnostics").at(-1) ?? "";
    for (const id of ["empty-fixture", "wrong-call", "ignored-import"]) {
      expect(stdout).toContain(
        `kept     ${id} (should fail there): kept with its control unestablished`,
      );
      expect(held).toContain(`generated check ${id} is held`);
    }
    expect(result?.outcome?.interventions?.repairAttempts).toBe(1);
    expect(stdout).not.toContain("A second repair was asked for.");
    // The supplied contract's check passes; the kept checks leave the run unresolved, and say why.
    expect(result?.outcome?.status).toBe("unresolved");
    expect(code).toBe(1);
  }, 200_000);

  it("admits a correct adapter with legitimate null answers, object inputs and a preservation of one value", async () => {
    // pear stays null, legitimately; apple is the known-working case that shows the program reaches
    // the project. A check of null answers alone, and a preservation whose every answer is null,
    // take that control from the identical program. Object inputs, including one with its own
    // input field, reach the program as written.
    const objects =
      "import lookup from './lookup.mjs';\nexport default (query) => ({ word: query.input, kind: lookup.kindOf(query.input) });\n";
    const { stdout, code } = await swarm(
      [
        {
          toolCalls: [
            lookupCheck("case-rule", adapter, [
              { input: "Apple", expected: "fruit" },
              { input: "apple", expected: "fruit" },
              { input: "pear", expected: null },
            ]),
            lookupCheck("query-objects", objects, [
              {
                input: { input: "Apple" },
                expected: { word: "Apple", kind: "fruit" },
                changed: true,
              },
              {
                input: { input: "carrot" },
                expected: { word: "carrot", kind: "vegetable" },
                changed: false,
              },
            ]),
            lookupCheck("nulls-only", adapter, [
              { input: "Apple", expected: "fruit" },
              { input: "pear", expected: null },
            ]),
            lookupCheck(
              "unknown-words",
              adapter,
              [
                { input: "pear", expected: null },
                { input: "banana", expected: null },
              ],
              "preserve",
            ),
            lookupReview,
          ],
        },
        { text: "Pinned." },
        { text: "Plan: lower the word before the lookup.", ...lookupFix },
        { text: "Done." },
      ],
      false,
      [],
      true,
      lookupWorkspace(),
      lookupTask,
    );

    const result = resultOf(stdout);
    expect(result?.plannedChecks?.admitted, stdout.slice(-4000)).toEqual([
      "case-rule",
      "query-objects",
      "nulls-only",
      "unknown-words",
    ]);
    expect(result?.plannedChecks?.dropped).toEqual([]);
    expect(stdout).toMatch(/admitted nulls-only .*its control is planned check case-rule's/);
    expect(stdout).toMatch(/admitted unknown-words .*its control is planned check case-rule's/);
    // Each admitted check passes on the fix.
    expect(
      result?.outcome?.requirements?.find((one) => one.id === "case")?.generatedChecks,
    ).toEqual([
      expect.objectContaining({ id: "case-rule", status: "accepted" }),
      expect.objectContaining({ id: "query-objects", status: "accepted" }),
      expect.objectContaining({ id: "nulls-only", status: "accepted" }),
      expect.objectContaining({ id: "unknown-words", status: "accepted" }),
    ]);
    expect(result?.outcome?.status).toBe("accepted");
    expect(code).toBe(0);
  }, 200_000);

  it("keeps a check whose defect is one answer for every input, and passes it on the fix", async () => {
    // isPositive answers false for -1, 0 and 1 on the base. That one value is the defect, not a
    // broken adapter: kept with its control unestablished, it fails on the base and passes on the
    // correct implementation.
    const { stdout, code } = await swarm(
      [
        {
          toolCalls: [
            {
              name: "declare_planned_check",
              input: {
                id: "positive",
                purpose: "change",
                requirementId: "positive",
                requirement: "true for positive numbers, false otherwise",
                quote: "true for positive numbers and false otherwise",
                program:
                  "import { isPositive } from './sign.mjs';\nexport default function (n) {\n  return isPositive(n);\n}\n",
                cases: [
                  { input: -1, expected: false, changed: false },
                  { input: 0, expected: false, changed: false },
                  { input: 1, expected: true, changed: true },
                ],
                why: "the defect is that every input gives false",
              },
            },
            {
              name: "declare_coverage_review",
              input: {
                id: "positive-review",
                requirementId: "positive",
                change: "positive numbers give true",
                keeps: "zero and negative numbers give false",
                wrongImplementation: "n >= 0, which calls zero positive",
                distinguishedBy: ["positive"],
                noRelation: "a numeric rule has no text substitution",
                untested: "non-integer and non-number inputs",
              },
            },
          ],
        },
        { text: "Pinned." },
        {
          text: "Plan: compare with zero.",
          toolCalls: [{ name: "declare_file_set", input: { files: ["sign.mjs"] } }],
        },
        {
          toolCalls: [
            {
              name: "write",
              input: {
                path: "sign.mjs",
                content: "export function isPositive(n) {\n  return n > 0;\n}\n",
              },
            },
          ],
        },
        { text: "Done." },
      ],
      false,
      [],
      true,
      signWorkspace(),
      signTask,
    );

    expect(stdout).toMatch(
      /kept +positive \(should fail there\): kept with its control unestablished/,
    );
    const result = resultOf(stdout);
    expect(result?.plannedChecks?.admitted, stdout.slice(-4000)).toEqual(["positive"]);
    expect(
      result?.outcome?.requirements?.find((one) => one.id === "positive")?.generatedChecks,
    ).toEqual([expect.objectContaining({ id: "positive", status: "accepted" })]);
    expect(result?.outcome?.status).toBe("accepted");
    expect(code).toBe(0);
  }, 200_000);
});
