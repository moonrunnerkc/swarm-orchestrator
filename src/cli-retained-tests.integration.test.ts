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
 * Tests a worker wrote and then deleted or changed, through the ordinary command line on a
 * scripted model (test-retention-v1). Scripted turns establish the controller's mechanics, not
 * what a model would do. The project's drop(input, keep) must ask keep once per key; the October
 * 24 shape asks about the first key twice, and the worker's own test of that fails, is piped so
 * its run exits 0, and is deleted before the first gate cycle.
 */
let scratch = "";
let home = "";
const endpoints: ScriptedEndpoint[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-retained-cli-"));
  home = join(scratch, "home");
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) await endpoint.close();
  await rm(scratch, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]) =>
  (
    await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd })
  ).stdout.trim();

const query = [
  "export function parse(input) {",
  '  const at = input.indexOf("?");',
  "  const out = {};",
  "  if (at === -1) return out;",
  '  for (const part of input.slice(at + 1).split("&")) {',
  '    const [key, value = ""] = part.split("=");',
  "    if (key.length > 0) out[key] = value;",
  "  }",
  "  return out;",
  "}",
  "",
].join("\n");
const task =
  'query.mjs has parse(input). Add drop(input, keep) to query.mjs, returning the keys of parse(input) for which keep(key, value) returns true, joined with "&". keep is called once for each key of parse(input), in that order. Example: drop("/a?x=1&y=2", (key) => key !== "x") is "y".';
const check =
  "import assert from 'node:assert/strict';\nimport { drop } from '../query.mjs';\nassert.equal(drop('/a?x=1&y=2', (key) => key !== 'x'), 'y');\n";
const askedTwice = `${query}export function drop(input, keep) {
  const keys = Object.keys(parse(input));
  for (const key of keys) if (keep(key, parse(input)[key])) break;
  return keys.filter((key) => keep(key, parse(input)[key])).join("&");
}
`;
const askedOnce = `${query}export function drop(input, keep) {
  return Object.entries(parse(input)).filter(([key, value]) => keep(key, value)).map(([key]) => key).join("&");
}
`;
const header =
  "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { drop, parse } from './query.mjs';\n";
const baseTest = `${header.replace("drop, parse", "parse")}test('parses a key', () => assert.equal(parse('/a?x=1').x, '1'));\n`;
const exampleTest =
  "test('drops the key', () => assert.equal(drop('/a?x=1&y=2', (key) => key !== 'x'), 'y'));\n";
const callCount = (expected: string) =>
  `test('asks keep once per key', () => {\n  const calls = [];\n  drop('/a?x=1&y=2', (key) => { calls.push(key); return true; });\n  assert.deepEqual(calls, ${expected});\n});\n`;
const withCount = (expected: string) =>
  `${header}test('parses a key', () => assert.equal(parse('/a?x=1').x, '1'));\n${exampleTest}${callCount(expected)}`;
const withoutCount = `${header}test('parses a key', () => assert.equal(parse('/a?x=1').x, '1'));\n${exampleTest}`;

const write = (path: string, content: string): ScriptedTurn => ({
  toolCalls: [{ name: "write", input: { path, content } }],
});
const shell = (command: string): ScriptedTurn => ({
  toolCalls: [{ name: "shell", input: { command } }],
});
const declare = (files: readonly string[]): ScriptedTurn => ({
  toolCalls: [{ name: "declare_file_set", input: { files } }],
});

/** The worker's loop in order, and the attempt owed on retained tests, told apart by its brief. */
function roles(worker: readonly ScriptedTurn[], repair: readonly ScriptedTurn[] = []) {
  let first = 0;
  let second = 0;
  const route: ScriptedTurnSource = (request) =>
    JSON.stringify(request).includes("Tests you wrote earlier in this run and later deleted")
      ? (repair[second++] ?? { text: "Done with the retained tests." })
      : (worker[first++] ?? { text: "Done." });
  return Array.from({ length: 60 }, () => route);
}

interface Retained {
  readonly open: readonly string[];
  readonly cases: readonly { identity: string; kind: string; state: string }[];
  readonly attempt: { state: string; attempt: number | null; accepted: boolean | null } | null;
}

async function swarm(turns: readonly ScriptedTurnSource[]) {
  const endpoint = await startScriptedEndpoint({ modelId: "stub", turns });
  endpoints.push(endpoint);
  const directory = join(scratch, "workspace");
  await mkdir(join(directory, "acceptance"), { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "query", type: "module", scripts: { test: "node --test" } }),
  );
  await writeFile(join(directory, "query.mjs"), query);
  await writeFile(join(directory, "query.test.mjs"), baseTest);
  await writeFile(join(directory, "acceptance", "check.mjs"), check);
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-qm", "base");
  const contract = join(scratch, "contract.json");
  await writeFile(
    contract,
    JSON.stringify({
      version: 1,
      goal: "drop",
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
  let stdout = "";
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
        await git(directory, "rev-parse", "HEAD"),
        "--goal-contract",
        contract,
        "--approve",
        "auto",
        "--no-tui",
        "--no-open-evidence",
        "--json",
      ],
      {
        cwd: directory,
        env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" },
        timeout: 240_000,
      },
    );
    stdout = `${ran.stdout}\n${ran.stderr}`;
  } catch (cause) {
    const failed = cause as { stdout?: string; stderr?: string };
    stdout = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
  }
  const result =
    stdout
      .split("\n")
      .filter((one) => one.startsWith("{"))
      .map(
        (one) =>
          JSON.parse(one) as {
            type?: string;
            bundleDirectory?: string;
            verdict?: { acceptable?: boolean };
            outcome?: { status?: string; retained?: Retained };
          },
      )
      .find((one) => one.type === undefined && one.bundleDirectory !== undefined) ?? {};
  return { result, stdout, directory };
}

/** Every test-retention-v1 reading the run recorded, in order. */
function readings(
  bundle: string,
): readonly { cases: readonly { name: string; state: string }[] }[] {
  const session = join(bundle, "..");
  return readFileSync(join(session, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
    .filter((one) => one.type === "verification-command")
    .map(
      (one) =>
        JSON.parse(
          readFileSync(join(session, "blobs", `${one.payloadDigest.slice(7)}.json`), "utf8"),
        ) as { rule?: string; cases?: never[] },
    )
    .filter((one) => one.rule === "test-retention-v1")
    .map((one) => ({ cases: one.cases ?? [] }));
}

async function verified(bundle: string): Promise<void> {
  const checked = await run(process.execPath, [join(bundle, "verify.mjs"), bundle]).then(
    () => ({ code: 0, stdout: "" }),
    (failed: { code?: number; stdout?: string }) => ({
      code: failed.code ?? 1,
      stdout: failed.stdout ?? "",
    }),
  );
  expect(checked.code, checked.stdout.slice(-3000)).toBe(0);
}

/** The worker writes the defect and its own failing test, runs it piped, and deletes the test. */
const deletesItsFailingTest = [
  declare(["query.mjs", "query.test.mjs"]),
  write("query.mjs", askedTwice),
  write("query.test.mjs", withCount("['x', 'y']")),
  shell("node --test query.test.mjs 2>&1 | tail -5"),
  write("query.test.mjs", withoutCount),
];

describe("tests the worker deleted or changed, kept through the run (test-retention-v1)", () => {
  it("a failure found and deleted before the first gate cycle stays open, is owed an attempt, and the repair resolves it", async () => {
    const { result, stdout, directory } = await swarm(
      roles(deletesItsFailingTest, [write("query.mjs", askedOnce)]),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(readFileSync(join(directory, "query.mjs"), "utf8")).toBe(askedOnce);
    const seen = readings(result.bundleDirectory ?? "");
    // Read on the first gated candidate, which never held the test: open.
    expect(seen[0]?.cases.map((one) => [one.name, one.state])).toEqual([
      ["asks keep once per key", "open"],
    ]);
    // Read again on the repaired candidate: the code now meets it.
    expect(seen.at(-1)?.cases.map((one) => one.state)).toEqual(["passes"]);
    expect(result.outcome?.retained?.attempt).toMatchObject({ state: "given", accepted: true });
    expect(result.outcome?.retained?.open).toEqual([]);
    await verified(result.bundleDirectory ?? "");
  }, 240_000);

  it("a deleted test still failing after an attempt given it is reported open, stops the attempts, and decides nothing", async () => {
    const { result, stdout } = await swarm(
      roles(deletesItsFailingTest, [{ text: "Nothing to do." }]),
    );
    // A retained test is a model's expectation: open, it is reported and does not refuse the run.
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.retained?.open).toEqual(["query.test.mjs > asks keep once per key"]);
    const session = join(result.bundleDirectory ?? "", "..");
    const owed = readFileSync(join(session, "ledger.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payloadDigest: string })
      .filter((one) => one.type === "verification-command")
      .map(
        (one) =>
          JSON.parse(
            readFileSync(join(session, "blobs", `${one.payloadDigest.slice(7)}.json`), "utf8"),
          ) as { rule?: string; state?: string; attempt?: number | null; reason?: string },
      )
      .filter((one) => one.rule === "test-retention-attempt-v1");
    expect(owed.map((one) => [one.state, one.attempt])).toEqual([
      ["given", 1],
      ["withheld", null],
    ]);
    expect(owed[1]?.reason).toContain("repeated-failure stop");
    await verified(result.bundleDirectory ?? "");
  }, 240_000);

  it("a legitimately wrong test the worker corrects is kept as corrected, and owes nothing", async () => {
    const { result, stdout } = await swarm(
      roles([
        declare(["query.mjs", "query.test.mjs"]),
        write("query.mjs", askedOnce),
        write("query.test.mjs", withCount("['x', 'y', 'z']")),
        shell("node --test query.test.mjs 2>&1 | tail -5"),
        write("query.test.mjs", withCount("['x', 'y']")),
      ]),
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.retained?.cases.map((one) => [one.kind, one.state])).toEqual([
      ["changed", "corrected"],
    ]);
    expect(result.outcome?.retained?.open).toEqual([]);
    expect(result.outcome?.retained?.attempt).toBeNull();
    await verified(result.bundleDirectory ?? "");
  }, 240_000);
});
