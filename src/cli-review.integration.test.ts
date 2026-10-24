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

/** More of the project: scripts beside its test script, and files beside its own. */
interface Extra {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly files?: Readonly<Record<string, string>>;
}

async function workspace(
  check: string,
  suite = baseTest,
  extra: Extra = {},
): Promise<{ directory: string; base: string; contract: string }> {
  const directory = join(scratch, "workspace");
  await mkdir(join(directory, "acceptance"), { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "labels",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test", ...(extra.scripts ?? {}) },
    }),
  );
  await writeFile(join(directory, "label.mjs"), base);
  await writeFile(join(directory, "label.test.mjs"), suite);
  await writeFile(join(directory, "acceptance", "check.mjs"), check);
  for (const [path, content] of Object.entries(extra.files ?? {}))
    await writeFile(join(directory, path), content);
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
    readonly checks?: { readonly result: string };
    readonly deliveredPatch?: string;
    readonly unclassifiedTask?: readonly string[];
    readonly preservation?: readonly {
      id: string;
      source: string;
      category?: string;
      status: string;
      evidence?: readonly unknown[];
    }[];
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
  extra: Extra = {},
): Promise<{ result: Result; code: number; stdout: string; directory: string }> {
  const endpoint = await startScriptedEndpoint({ modelId: "stub", turns });
  endpoints.push(endpoint);
  const prepared = await workspace(check, suite, extra);
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

/** The review's examination record, read from the session ledger beside the bundle. */
function examination(bundle: string): {
  readonly validation: readonly { probe: string; round: number; kind: string; reused: boolean }[];
  readonly dropped: readonly { id: string; reason: string }[];
} {
  const session = join(bundle, "..");
  const payloads = readFileSync(join(session, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
    .filter((one) => one.type === "verification-command")
    .map(
      (one) =>
        JSON.parse(
          readFileSync(join(session, "blobs", `${one.payloadDigest.slice(7)}.json`), "utf8"),
        ) as { rule?: string; phase?: string; validation?: never[]; dropped?: never[] },
    );
  const found = payloads.find(
    (one) => one.rule === "candidate-review-v4" && one.phase === "examined",
  );
  return { validation: found?.validation ?? [], dropped: found?.dropped ?? [] };
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
      "code-requested#1 met",
      "trims-names#1 kept",
      "trims-names#2 kept",
      "upper-option#1 met",
    ]);
    expect(result.outcome?.review?.attempt).toBeNull();
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    const statuses = Object.fromEntries(
      (result.outcome?.preservation ?? []).map((one) => [one.id, one.status]),
    );
    // Examples kept the base's answers: the task's sentence is exercised, not shown whole.
    expect(statuses).toMatchObject({
      "task-keep-1": "exercised",
      "base-suite": "held",
      "review-trims-names": "exercised",
      "contract-visible-check": "met",
    });
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
      "code-requested#1 met",
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

  it("an authorized behaviour change is not rejected as a regression, though a probe calls it one, and no repair is spent on it", async () => {
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
    // The probe names no obligation the task states for the ending, which the task changes: a
    // difference, reported, owing nothing.
    expect(result.outcome?.review?.attempt).toBeNull();
    expect(readingsOf(result)).toEqual([
      "code-requested#1 met",
      "trims-names#1 difference",
      "trims-names#2 difference",
    ]);
    expect(
      result.outcome?.preservation?.find((one) => one.id === "review-trims-names"),
    ).toMatchObject({
      source: "review",
      category: "proposed",
      status: "unmeasured",
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
    // The reviewer proposed nothing; the harness ran the task's own example, which the change meets.
    expect(result.outcome?.review?.examination).toMatch(/^sha256:/);
    expect(result.outcome?.review?.attempt).toBeNull();
    expect(readingsOf(result)).toEqual(["code-requested#1 met"]);
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

  it("a reviewer's wrong expectation is reported and never drives a repair of correct work", async () => {
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
    // Under candidate-review-v1 this expectation was established and its repair had to be
    // rolled back; it is the reviewer's reading of the task, so nothing is owed for it.
    expect(result.outcome?.review?.attempt).toBeNull();
    expect(readingsOf(result)).toContain("upper-without-colon#1 missed-requirement");
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
    // Admission ran each once, sent both back once with their errors, ran the same programs again,
    // and left them out as unmeasured: neither reads as nothing wrong found.
    expect(readingsOf(result)).toEqual(["code-requested#1 met"]);
    const examined = examination(result.bundleDirectory ?? "");
    expect(examined.validation.map((one) => `${one.probe} ${one.round} ${one.kind}`)).toEqual([
      "missing-module 1 load-failure",
      "throws-itself 1 probe-failure",
      "missing-module 2 load-failure",
      "throws-itself 2 probe-failure",
    ]);
    // The second round ran the same program on the same candidate, so it read the first's trial.
    expect(examined.validation.map((one) => one.reused)).toEqual([false, false, true, true]);
    expect(examined.dropped.map((one) => one.reason)).toEqual([
      expect.stringMatching(
        /^unmeasured: it did not run as written \(on a copy of the change: load-failure: the program did not load: .*missing\.mjs/,
      ),
      expect.stringMatching(
        /^unmeasured: it did not run as written \(on a copy of the change: probe-failure: it threw in its own code/,
      ),
    ]);
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("a broken probe corrected under a new id runs, and an empty optional field is read as absent", async () => {
    const { result, stdout } = await swarm(
      upperTask,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", correctUpper)],
        reviewer: [
          {
            probes: [
              {
                ...trimming,
                id: "missing-module",
                program:
                  "import { label } from './missing.mjs';\nexport default (input) => label(input.name);\n",
              },
            ],
          },
          { probes: [{ ...trimming, id: "trims-again", keeps: "" }] },
        ],
      }),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(readingsOf(result)).toEqual([
      "code-requested#1 met",
      "trims-again#1 kept",
      "trims-again#2 kept",
    ]);
    const examined = examination(result.bundleDirectory ?? "");
    expect(examined.validation.map((one) => `${one.probe} ${one.round} ${one.kind}`)).toEqual([
      "missing-module 1 load-failure",
      "trims-again 2 observation",
    ]);
    expect(examined.dropped.map((one) => one.id)).toEqual(["missing-module"]);
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
    expect(readingsOf(result)).toEqual([
      "code-requested#1 met",
      "trims-names#1 kept",
      "trims-names#2 kept",
    ]);
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

  /** A formatter stand-in that names each file carrying the marker, as Prettier's --check does. */
  const marker = "/* unformatted */";
  const formatter = [
    'import { readdirSync, readFileSync } from "node:fs";',
    'const marker = ["/* unfor", "matted */"].join("");',
    'console.log("Checking formatting...");',
    'const marked = readdirSync(".").filter((name) => name.endsWith(".mjs") && readFileSync(name, "utf8").includes(marker)).sort();',
    'for (const name of marked) console.error("[warn] " + name);',
    "if (marked.length > 0) {",
    '  console.error("[warn] Code style issues found in " + (marked.length === 1 ? "the above file" : marked.length + " files") + ". Run Prettier with --write to fix.");',
    "  process.exit(1);",
    "}",
    "",
  ].join("\n");
  const inheritedLint: Extra = {
    scripts: { lint: "node fmt.mjs" },
    files: { "fmt.mjs": formatter, "legacy.mjs": `${marker}\nexport const legacy = 1;\n` },
  };

  /** The digest the final verification applied, from the bundle's own ledger. */
  function appliedPatchDigest(bundle: string): string | undefined {
    const ledger = readFileSync(join(bundle, "ledger.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payloadDigest: string });
    const last = ledger.filter((one) => one.type === "independent-verification").at(-1);
    if (last === undefined) return undefined;
    const payload = JSON.parse(
      readFileSync(join(bundle, "blobs", `${last.payloadDigest.slice(7)}.json`), "utf8"),
    ) as { appliedPatchDigest?: string };
    return payload.appliedPatchDigest;
  }

  it("reviews a runnable candidate whose only failing check is the base's own lint, repairs the broken case, and verifies the delivered tree", async () => {
    const { result, code, stdout, directory } = await swarm(
      upperTask,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", untrimmedUpper)],
        reviewer: { probes: [trimming, upperProbe] },
        repair: [write("label.mjs", correctUpper)],
      }),
      "executable",
      baseTest,
      inheritedLint,
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(code).toBe(0);
    expect(result.outcome?.checks?.result).toBe("no-new-failures");
    // The review ran (the base's lint did not withhold it), its counterexample drove the repair,
    // and the repaired candidate was kept.
    expect(result.outcome?.review?.attempt).toMatchObject({ state: "given", accepted: true });
    expect(readingsOf(result)).toEqual([
      "code-requested#1 met",
      "trims-names#1 kept",
      "trims-names#2 kept",
      "upper-option#1 met",
    ]);
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    // The preservation statuses and the final verification were read on the same delivered tree.
    expect(result.outcome?.deliveredPatch).toMatch(/^sha256:/);
    expect(appliedPatchDigest(result.bundleDirectory ?? "")).toBe(result.outcome?.deliveredPatch);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("reviews a candidate whose own lint finding is still failing, and one attempt repairs both", async () => {
    const { result, stdout, directory } = await swarm(
      upperTask,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", `${marker}\n${untrimmedUpper}`)],
        reviewer: { probes: [trimming] },
        repair: [write("label.mjs", correctUpper)],
      }),
      "executable",
      baseTest,
      inheritedLint,
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toMatchObject({ state: "given", accepted: true });
    expect(readFileSync(join(directory, "label.mjs"), "utf8")).toBe(correctUpper);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("keeps clear preservation wording and every one of more than twelve obligations visible, and reports new behaviour apart", async () => {
    const keeps = Array.from(
      { length: 12 },
      (_, index) => `Option ${index + 1} must keep working.`,
    ).join(" ");
    const long = `${upperTask} All public exports must remain available. ${keeps}`;
    const { result, stdout } = await swarm(
      long,
      upperCheck,
      roles({
        worker: [declare(["label.mjs"]), write("label.mjs", correctUpper)],
        reviewer: { probes: [] },
      }),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    const preservation = result.outcome?.preservation ?? [];
    const fromTask = preservation.filter((one) => one.source === "task");
    // Fourteen sentences, and the example the task writes as code.
    expect(fromTask).toHaveLength(15);
    expect(fromTask.map((one) => one.category)).toEqual([
      ...Array(14).fill("explicit-preserve"),
      "requested",
    ]);
    expect(preservation.find((one) => one.id === "contract-visible-check")).toMatchObject({
      category: "requested",
      status: "met",
    });
    // The task's own example, run by the review on the delivered candidate.
    expect(preservation.find((one) => one.id === "code-example-1")).toMatchObject({
      category: "requested",
      status: "met",
    });
    expect(result.outcome?.unclassifiedTask).toContain(
      "Add an `upper` option to label(name, options): with { upper: true } the label is upper-case, so label('ann', { upper: true }) gives 'ANN:'.",
    );
    expect(stdout).toContain("requested behaviour (new, not preserved): 2 met");
  }, 240_000);
});

/**
 * Requested behaviour the task states in terms of existing functions (task-code-v1 and relation
 * probes). query.mjs has parse(input) and rebuild(input, extra), and rebuild writes `file:///` as
 * `file://`. The task asks for drop(input, keep) and relates it to both, and the visible check has
 * one example, which every candidate here meets.
 */
const queryBase = [
  "export function parse(input) {",
  '  const at = input.indexOf("?");',
  "  const out = Object.create(null);",
  "  if (at === -1) return out;",
  '  for (const part of input.slice(at + 1).split("&")) {',
  "    if (part.length === 0) continue;",
  '    const [rawKey, rawValue = ""] = part.split("=");',
  "    const key = decodeURIComponent(rawKey);",
  "    const value = decodeURIComponent(rawValue);",
  "    out[key] = key in out ? [].concat(out[key], value) : value;",
  "  }",
  "  return out;",
  "}",
  "const encoded = (query) =>",
  "  Object.entries(query)",
  '    .flatMap(([key, value]) => [].concat(value).map((one) => encodeURIComponent(key) + "=" + encodeURIComponent(one)))',
  '    .join("&");',
  "export function rebuild(input, extra) {",
  '  const at = input.indexOf("?");',
  '  const head = (at === -1 ? input : input.slice(0, at)).replace(/^file:\\/\\/\\//, "file://");',
  "  const text = encoded({ ...parse(input), ...extra });",
  '  return text.length === 0 ? head : head + "?" + text;',
  "}",
  "",
].join("\n");
const dropTask =
  'query.mjs has parse(input) and rebuild(input, extra). Add drop(input, keep) to query.mjs, returning input with only the parameters for which keep(key, value) returns true. keep is called once for each key of parse(input), in that order, with the key and the value parse gives it. drop(input, () => true) equals rebuild(input, {}) for every input that contains "?". Examples: drop("/a?x=1&y=2", (key) => key !== "x") is "/a?y=2", and drop("file:///C:/x", () => false) is "file:///C:/x".';
const dropCheck =
  "import assert from 'node:assert/strict';\nimport { drop } from '../query.mjs';\nassert.equal(drop('/a?x=1&y=2', (key) => key !== 'x'), '/a?y=2');\n";
/** Rebuilds the head as given, not as rebuild does: wrong for `file:///C:/x?...`. */
const dropVerbatim = `${queryBase}export function drop(input, keep) {
  const at = input.indexOf("?");
  if (at === -1) return input;
  const kept = Object.fromEntries(Object.entries(parse(input)).filter(([key, value]) => keep(key, value)));
  const text = encoded(kept);
  return text.length === 0 ? input.slice(0, at) : \`\${input.slice(0, at)}?\${text}\`;
}
`;
/** Rebuilds through rebuild, but asks keep about the first key twice. */
const dropTwice = `${queryBase}export function drop(input, keep) {
  if (!input.includes("?")) return input;
  const entries = Object.entries(parse(input));
  if (entries.length > 0 && !keep(entries[0][0], entries[0][1]) && entries.length === 1)
    return rebuild(input.slice(0, input.indexOf("?")), {});
  const kept = Object.fromEntries(entries.filter(([key, value]) => keep(key, value)));
  return rebuild(input.slice(0, input.indexOf("?")), kept);
}
`;
const dropCorrect = `${queryBase}export function drop(input, keep) {
  if (!input.includes("?")) return input;
  const kept = Object.fromEntries(Object.entries(parse(input)).filter(([key, value]) => keep(key, value)));
  return rebuild(input.slice(0, input.indexOf("?")), kept);
}
`;
const callOrder = {
  id: "keep-call-order",
  basis: "relation",
  quote:
    "keep is called once for each key of parse(input), in that order, with the key and the value parse gives it",
  program:
    'const project = await import("./query.mjs");\nexport default (input) => {\n  const calls = [];\n  project.drop(input, (key, value) => {\n    calls.push([key, value]);\n    return true;\n  });\n  return calls;\n};\n',
  reference:
    'const project = await import("./query.mjs");\nexport default (input) => Object.entries(project.parse(input));\n',
  cases: [{ input: "/a" }, { input: "/a?x=1&y=2&x=3" }],
};

describe("requested behaviour the task states, measured and repaired", () => {
  const dropWorkspace = { files: { "query.mjs": queryBase } };

  it("a relation the task writes as code finds the counterexample, the repair fixes it, and the delivered tree is the one measured", async () => {
    const { result, stdout, directory } = await swarm(
      dropTask,
      dropCheck,
      roles({
        worker: [declare(["query.mjs"]), write("query.mjs", dropVerbatim)],
        reviewer: { probes: [] },
        repair: [write("query.mjs", dropCorrect)],
      }),
      "executable",
      baseTest,
      dropWorkspace,
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toMatchObject({ state: "given", accepted: true });
    expect(readFileSync(join(directory, "query.mjs"), "utf8")).toBe(dropCorrect);
    // Read again on the delivered candidate: every case of the task's code holds there, the
    // generated discovery inputs and the validation batch held back from the repair included.
    const readings = readingsOf(result);
    expect(readings.slice(0, 4)).toEqual([
      "code-requested#1 met",
      "code-requested#2 met",
      "code-relation-1#1 related",
      "code-relation-1#2 related",
    ]);
    expect(readings.filter((one) => one.startsWith("code-relation-1#")).length).toBeGreaterThan(2);
    expect(
      readings.filter((one) => one.startsWith("code-relation-1-held#")).length,
    ).toBeGreaterThan(0);
    expect(readings.every((one) => / (met|related)$/.test(one))).toBe(true);
    const statuses = Object.fromEntries(
      (result.outcome?.preservation ?? []).map((one) => [one.id, one.status]),
    );
    expect(statuses).toMatchObject({
      "code-example-1": "met",
      "code-example-2": "met",
      "code-relation-1": "exercised",
    });
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("a repair the ratchet rolls back leaves the delivered candidate's readings in the report", async () => {
    // The repair fixes the relation and breaks the visible example, so the gates refuse it, and
    // the delivered tree is the first candidate: what is reported is what that tree does.
    const brokenRepair = dropCorrect.replace(
      "filter(([key, value]) => keep(key, value))",
      "filter(() => true)",
    );
    const { result, stdout, directory } = await swarm(
      dropTask,
      dropCheck,
      roles({
        worker: [declare(["query.mjs"]), write("query.mjs", dropVerbatim)],
        reviewer: { probes: [] },
        repair: [write("query.mjs", brokenRepair)],
      }),
      "executable",
      baseTest,
      dropWorkspace,
    );
    expect(result.outcome?.review?.attempt, stdout.slice(-3000)).toMatchObject({
      state: "given",
      accepted: false,
    });
    expect(readFileSync(join(directory, "query.mjs"), "utf8")).toBe(dropVerbatim);
    expect(readingsOf(result)).toContain("code-relation-1#2 relation-violated");
    expect(
      (result.outcome?.preservation ?? []).find((one) => one.id === "code-relation-1")?.status,
    ).toBe("unmet");
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("a reviewer's relation over an existing function finds a callback called twice, and the repair fixes it", async () => {
    const { result, stdout, directory } = await swarm(
      dropTask,
      dropCheck,
      roles({
        worker: [declare(["query.mjs"]), write("query.mjs", dropTwice)],
        reviewer: { probes: [callOrder] },
        repair: [write("query.mjs", dropCorrect)],
      }),
      "executable",
      baseTest,
      dropWorkspace,
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toMatchObject({ state: "given", accepted: true });
    expect(readFileSync(join(directory, "query.mjs"), "utf8")).toBe(dropCorrect);
    expect(readingsOf(result)).toContain("keep-call-order#2 related");
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("a correct candidate is not accused, and nothing is owed", async () => {
    const { result, stdout, directory } = await swarm(
      dropTask,
      dropCheck,
      roles({
        worker: [declare(["query.mjs"]), write("query.mjs", dropCorrect)],
        reviewer: { probes: [callOrder] },
      }),
      "executable",
      baseTest,
      dropWorkspace,
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toBeNull();
    expect(readFileSync(join(directory, "query.mjs"), "utf8")).toBe(dropCorrect);
    expect(readingsOf(result).every((one) => / (met|related)$/.test(one))).toBe(true);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("a reviewer's relation that holds on no input is its own reading, and owes nothing", async () => {
    // Its reference answers in other terms (the keys alone), so no input agrees: a translation
    // nothing confirms, whatever the candidate does.
    const mistranslated = {
      ...callOrder,
      reference:
        'const project = await import("./query.mjs");\nexport default (input) => Object.keys(project.parse(input)).concat("x");\n',
    };
    const { result, stdout } = await swarm(
      dropTask,
      dropCheck,
      roles({
        worker: [declare(["query.mjs"]), write("query.mjs", dropCorrect)],
        reviewer: { probes: [mistranslated] },
      }),
      "executable",
      baseTest,
      dropWorkspace,
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.review?.attempt).toBeNull();
    expect(readingsOf(result)).toContain("keep-call-order#2 relation-unconfirmed");
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);
});
