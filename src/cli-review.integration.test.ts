import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ScriptedEndpoint,
  type ScriptedTurn,
  type ScriptedTurnSource,
  startScriptedEndpoint,
} from "./providers/scripted-endpoint.ts";

const run = promisify(execFile);

/**
 * The experimental candidate review through the ordinary command line, on a scripted model: the
 * deterministic development controls for the preservation stage. Each case drives the real
 * controller, gates, ratchet, final verification and the bundle's own verifier. The fixture's
 * label(name) trims the name, and the project's own suite never tests that, so the review is the
 * only thing here that can see it.
 */
let scratch = "";
let home = "";
const endpoints: ScriptedEndpoint[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-review-"));
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

const upperTask =
  "Add an `upper` option to label(name, options): with { upper: true } the label is upper-case, so label('ann', { upper: true }) gives 'ANN:'. Without the option, label(name) behaves as it does today, including trimming the spaces around the name.";
const dashTask =
  "Change label(name) to end with ' -' instead of ':', so label('bob') gives 'bob -'. Keep trimming the spaces around the name.";

const base = "export function label(name) {\n  return name.trim() + ':';\n}\n";
const baseTest =
  "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { label } from './label.mjs';\ntest('a name gets a colon', () => assert.equal(label('bob'), 'bob:'));\n";

const correctUpper =
  "export function label(name, options = {}) {\n  const text = name.trim() + ':';\n  return options.upper ? text.toUpperCase() : text;\n}\n";
/** Implements the option and stops trimming: the old case the suite never tests. */
const untrimmedUpper =
  "export function label(name, options = {}) {\n  const text = name + ':';\n  return options.upper ? text.toUpperCase() : text;\n}\n";
const correctDash = "export function label(name) {\n  return name.trim() + ' -';\n}\n";

async function workspace(
  check: string,
  suite = baseTest,
): Promise<{ directory: string; base: string; contract: string }> {
  const directory = join(scratch, "workspace");
  await mkdir(join(directory, "acceptance"), { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "labels",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  await writeFile(join(directory, "label.mjs"), base);
  await writeFile(join(directory, "label.test.mjs"), suite);
  await writeFile(join(directory, "acceptance", "check.mjs"), check);
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-qm", "base");
  const contract = join(scratch, "contract.json");
  await writeFile(
    contract,
    JSON.stringify({
      version: 1,
      goal: "label",
      requirements: [
        { id: "visible-check", description: "the visible check passes", checks: ["visible-check"] },
      ],
      checks: [
        {
          id: "visible-check",
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

const upperCheck =
  "import assert from 'node:assert/strict';\nimport { label } from '../label.mjs';\nassert.equal(label('ann', { upper: true }), 'ANN:');\nassert.equal(label('bob'), 'bob:');\n";
const dashCheck =
  "import assert from 'node:assert/strict';\nimport { label } from '../label.mjs';\nassert.equal(label('bob'), 'bob -');\n";

const write = (path: string, content: string): ScriptedTurn => ({
  toolCalls: [{ name: "write", input: { path, content } }],
});
const declare = (files: readonly string[]): ScriptedTurn => ({
  toolCalls: [{ name: "declare_file_set", input: { files } }],
});

const program =
  "import { label } from './label.mjs';\nexport default (input) => label(input.name, input.options);\n";
const trimming = {
  id: "trims-names",
  basis: "preserve",
  keeps: "label(name) trims the spaces around the name",
  quote:
    "Without the option, label(name) behaves as it does today, including trimming the spaces around the name",
  program,
  cases: [{ input: { name: "  ann  " } }, { input: { name: "bob" } }],
};
const upperProbe = {
  id: "upper-option",
  basis: "requirement",
  quote: "with { upper: true } the label is upper-case",
  program,
  cases: [{ input: { name: "ann", options: { upper: true } }, expected: "ANN:" }],
};

/**
 * One scripted model playing three parts, told apart by what each is sent: the worker's first
 * loop (in order), the reviewer, and the attempt the review's findings are owed.
 */
function roles(input: {
  readonly worker: readonly ScriptedTurn[];
  /** One answer, or one per review conversation in order (the last repeats). */
  readonly reviewer: unknown;
  readonly repair?: readonly ScriptedTurn[];
}): readonly ScriptedTurnSource[] {
  let worker = 0;
  let repair = 0;
  let reviews = 0;
  const route: ScriptedTurnSource = (request) => {
    const text = JSON.stringify(request);
    if (text.includes("You review a change another coding agent made")) {
      const answers = Array.isArray(input.reviewer) ? input.reviewer : [input.reviewer];
      return { text: JSON.stringify(answers[Math.min(reviews++, answers.length - 1)]) };
    }
    if (text.includes("A separate review of your change"))
      return input.repair?.[repair++] ?? { text: "Done with the review's findings." };
    return input.worker[worker++] ?? { text: "Done." };
  };
  return Array.from({ length: 60 }, () => route);
}

interface Result {
  readonly bundleDirectory?: string;
  readonly verdict?: { readonly acceptable?: boolean };
  readonly outcome?: {
    readonly status?: string;
    readonly preservation?: readonly { id: string; source: string; status: string }[];
    readonly review?: {
      readonly examination: string | null;
      readonly attempt: { state: string; accepted: boolean | null } | null;
      readonly readings: readonly { probe: string; index: number; reading: string }[];
    };
  };
}

async function swarm(
  task: string,
  check: string,
  turns: readonly ScriptedTurnSource[],
  mode: "executable" | "prose" = "executable",
  suite = baseTest,
): Promise<{ result: Result; code: number; stdout: string; directory: string }> {
  const endpoint = await startScriptedEndpoint({ modelId: "stub", turns });
  endpoints.push(endpoint);
  const prepared = await workspace(check, suite);
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
        prepared.directory,
        "--base",
        prepared.base,
        "--goal-contract",
        prepared.contract,
        "--review",
        mode,
        "--approve",
        "auto",
        "--no-tui",
        "--no-open-evidence",
        "--json",
      ],
      {
        cwd: prepared.directory,
        env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" },
        timeout: 240_000,
      },
    );
    stdout = `${ran.stdout}\n${ran.stderr}`;
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    code = failed.code ?? 1;
    stdout = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
  }
  const line = stdout
    .split("\n")
    .filter((one) => one.startsWith("{"))
    .map((one) => JSON.parse(one) as { type?: string; schema?: string } & Result)
    .find((one) => one.type === undefined && one.bundleDirectory !== undefined);
  return { result: line ?? {}, code, stdout, directory: prepared.directory };
}

/** The bundle's own verifier and re-deriver, run as a reviewer runs them. */
async function independentlyChecked(bundle: string): Promise<void> {
  const verified = await run(process.execPath, [join(bundle, "verify.mjs"), bundle]).then(
    () => ({ code: 0, stdout: "" }),
    (failed: { code?: number; stdout?: string }) => ({
      code: failed.code ?? 1,
      stdout: failed.stdout ?? "",
    }),
  );
  expect(verified.code, verified.stdout.slice(-3000)).toBe(0);
  const rederived = await run(process.execPath, [join(bundle, "rederive.mjs"), bundle]);
  expect(rederived.stdout).not.toMatch(/DISAGREES/);
}

const readingsOf = (result: Result) =>
  (result.outcome?.review?.readings ?? []).map((one) => `${one.probe}#${one.index} ${one.reading}`);

describe("the candidate review's development controls", () => {
  it("a correct change that keeps the old behaviour: probes agree, nothing is owed, it is delivered", async () => {
    const { result, code, stdout, directory } = await swarm(
      upperTask,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", correctUpper)],
        reviewer: { probes: [trimming, upperProbe] },
      }),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(code).toBe(0);
    expect(readingsOf(result)).toEqual([
      "trims-names#1 kept",
      "trims-names#2 kept",
      "upper-option#1 met",
    ]);
    expect(result.outcome?.review?.attempt).toBeNull();
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    const statuses = Object.fromEntries(
      (result.outcome?.preservation ?? []).map((one) => [one.id, one.status]),
    );
    expect(statuses).toMatchObject({ "base-suite": "kept", "review-trims-names": "kept" });
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("a plausible change that breaks an old case: the review finds it, the attempt repairs it, and both behaviours hold", async () => {
    const { result, stdout, directory } = await swarm(
      upperTask,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", untrimmedUpper)],
        reviewer: { probes: [trimming, upperProbe] },
        repair: [write("label.mjs", correctUpper)],
      }),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toMatchObject({ state: "given", accepted: true });
    expect(readingsOf(result)).toEqual([
      "trims-names#1 kept",
      "trims-names#2 kept",
      "upper-option#1 met",
    ]);
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  /** A suite that names the label without asserting its ending, as many suites do not. */
  const endingFreeSuite =
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { label } from './label.mjs';\ntest('a name is kept', () => assert.ok(label('bob').startsWith('bob')));\n";

  it("an authorized behaviour change is not rejected as a regression, though a probe calls it one", async () => {
    const { result, stdout, directory } = await swarm(
      dashTask,
      dashCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", correctDash)],
        // The reviewer wrongly treats the changed ending as behaviour to keep.
        reviewer: {
          probes: [{ ...trimming, quote: undefined, keeps: "label(name) ends with a colon" }],
        },
        repair: [{ text: "The task asks for this ending to change; leaving the code as it is." }],
      }),
      "executable",
      endingFreeSuite,
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctDash);
    expect(result.outcome?.review?.attempt).toMatchObject({ state: "given", accepted: true });
    expect(readingsOf(result)).toEqual([
      "trims-names#1 preservation-regression",
      "trims-names#2 preservation-regression",
    ]);
    // Reported for what it is: the reviewer's proposal, regressed by its own reading.
    expect(
      result.outcome?.preservation?.find((one) => one.id === "review-trims-names"),
    ).toMatchObject({
      source: "review",
      status: "regressed",
    });
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("documented limit: an authorized change that rewrites an existing test's expectation is left unverified", async () => {
    // The base's own test of the old ending fails against the new source; the verification cannot
    // tell an intended change from a weakened test there, so the suite's reading is unmeasured and
    // the run is not delivered, whatever the review would say (it never runs: the gates are not
    // green). The ratchet clears this one-for-one swap by its per-test re-specification rule; the
    // final verification's base-tests reading does not apply that rule yet.
    const { result } = await swarm(
      dashTask,
      dashCheck,
      roles({
        worker: [
          declare(["label.mjs", "label.test.mjs"]),
          write("label.mjs", correctDash),
          write(
            "label.test.mjs",
            baseTest.replace("'bob:'", "'bob -'").replace("gets a colon", "gets a dash"),
          ),
        ],
        reviewer: { probes: [] },
      }),
    );
    expect(result.outcome?.status).toBe("unverified");
    expect(result.outcome?.preservation?.find((one) => one.id === "base-suite")?.status).toBe(
      "unmeasured",
    );
    // The review was withheld on the record, since there was no green candidate to review.
    expect(result.outcome?.review?.examination).toMatch(/^sha256:/);
    expect(result.outcome?.review?.attempt).toBeNull();
    expect(result.outcome?.review?.readings).toEqual([]);
  }, 240_000);

  it("a weakened check that hides damage is refused", async () => {
    const weakened = baseTest.replace("'bob:'", "'bob: '");
    const { result, stdout } = await swarm(
      upperTask,
      upperCheck.replace("assert.equal(label('bob'), 'bob:');\n", ""),
      roles({
        worker: [
          declare(["label.mjs", "label.test.mjs"]),
          write("label.mjs", correctUpper.replace("name.trim() + ':'", "name.trim() + ': '")),
          write("label.test.mjs", weakened),
        ],
        reviewer: { probes: [] },
      }),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).not.toBe("accepted");
    expect(result.verdict?.acceptable).toBe(false);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("a damaging repair driven by a wrong expectation is rolled back to the incumbent", async () => {
    const wrong = {
      ...upperProbe,
      id: "upper-without-colon",
      cases: [{ input: { name: "ann", options: { upper: true } }, expected: "ANN" }],
    };
    const { result, stdout, directory } = await swarm(
      upperTask,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", correctUpper)],
        reviewer: { probes: [trimming, wrong] },
        // Satisfies the wrong expectation and stops trimming: the kept part held on the
        // incumbent breaks, and the supplied check breaks too.
        repair: [
          write(
            "label.mjs",
            "export function label(name, options = {}) {\n  return options.upper ? name.toUpperCase() : name + ':';\n}\n",
          ),
        ],
      }),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toMatchObject({ state: "given", accepted: false });
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("a broken probe establishes nothing and owes nothing", async () => {
    const { result, stdout, directory } = await swarm(
      upperTask,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", correctUpper)],
        reviewer: {
          probes: [
            {
              ...trimming,
              id: "missing-module",
              program:
                "import { label } from './missing.mjs';\nexport default (input) => label(input.name);\n",
            },
            {
              ...trimming,
              id: "throws-itself",
              program:
                "import { label } from './label.mjs';\nexport default (input) => input.nothing.length && label(input.name);\n",
            },
          ],
        },
      }),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toBeNull();
    expect(readingsOf(result)).toEqual([
      "missing-module#1 did-not-load",
      "missing-module#2 did-not-load",
      "throws-itself#1 defective-program",
      "throws-itself#2 defective-program",
    ]);
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("a first answer whose programs are paths gets one revision, and the revised probes run", async () => {
    const { result, stdout, directory } = await swarm(
      upperTask,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", untrimmedUpper)],
        reviewer: [
          { probes: [{ ...trimming, program: "./probes/trims.js" }] },
          { probes: [trimming] },
        ],
        repair: [write("label.mjs", correctUpper)],
      }),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toMatchObject({ state: "given", accepted: true });
    expect(readingsOf(result)).toEqual(["trims-names#1 kept", "trims-names#2 kept"]);
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("the prose control spends the same attempt with nothing run", async () => {
    const { result, stdout, directory } = await swarm(
      upperTask,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", untrimmedUpper)],
        reviewer: {
          objections: [
            { scenario: "label('  ann  ') keeps the spaces", expected: "'ann:' as today" },
          ],
        },
        repair: [write("label.mjs", correctUpper)],
      }),
      "prose",
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toMatchObject({ state: "given", accepted: true });
    expect(result.outcome?.review?.readings).toEqual([]);
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);
});
