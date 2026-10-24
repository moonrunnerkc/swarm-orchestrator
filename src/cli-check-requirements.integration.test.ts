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
  startScriptedEndpoint,
} from "./providers/scripted-endpoint.ts";

const run = promisify(execFile);

/**
 * check-requirement-v1 through the ordinary command line, on a scripted model: the real
 * controller, gates, repair loop, run assessment, final verification, result line, exit status
 * and the bundle's own verifier. A scripted model establishes what the controller does with a
 * given change; it says nothing about what a real model would write.
 *
 * The fixture's lint is a stand-in for Prettier's `--check`: it names each file carrying an
 * `/* unformatted *\/` marker, and the base's `legacy.mjs` carries one, so the base fails it.
 */
let scratch = "";
let home = "";
const endpoints: ScriptedEndpoint[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-requirements-"));
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

const marker = "/* unformatted */";
const prettierLike = [
  'import { readdirSync, readFileSync } from "node:fs";',
  'console.log("Checking formatting...");',
  // The marker is assembled here so this file does not carry it itself.
  'const marker = ["/* unfor", "matted */"].join("");',
  'const marked = readdirSync(".").filter((name) => name.endsWith(".mjs") && readFileSync(name, "utf8").includes(marker)).sort();',
  'for (const name of marked) console.error("[warn] " + name);',
  "if (marked.length > 0) {",
  '  console.error("[warn] Code style issues found in " + (marked.length === 1 ? "the above file" : marked.length + " files") + ". Run Prettier with --write to fix.");',
  "  process.exit(1);",
  "}",
  "",
].join("\n");
/** A stand-in for ESLint's stylish report, failing on legacy.mjs as the base does. */
const eslintLike = [
  'import { readFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'if (readFileSync("legacy.mjs", "utf8").includes("var ")) {',
  '  console.log("\\n" + join(process.cwd(), "legacy.mjs") + "\\n  1:1  error  Unexpected var, use let or const instead  no-var\\n\\n\\u2716 1 problem (1 error, 0 warnings)\\n");',
  "  process.exit(1);",
  "}",
  "",
].join("\n");

const task =
  "Add an `upper` option to label(name, options): with { upper: true } the label is upper-case, so label('ann', { upper: true }) gives 'ANN:'. Without the option, label(name) behaves as it does today.";
const base = "export function label(name) {\n  return name.trim() + ':';\n}\n";
const correct =
  "export function label(name, options = {}) {\n  const text = name.trim() + ':';\n  return options.upper ? text.toUpperCase() : text;\n}\n";
const legacy = `${marker}\nvar legacy = 1;\nexport { legacy };\n`;
const suite =
  "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { label } from './label.mjs';\ntest('a name gets a colon', () => assert.equal(label('bob'), 'bob:'));\n";
const check =
  "import assert from 'node:assert/strict';\nimport { label } from '../label.mjs';\nassert.equal(label('ann', { upper: true }), 'ANN:');\nassert.equal(label('bob'), 'bob:');\n";

async function workspace(lint: string, swarmToml?: string) {
  const directory = join(scratch, "workspace");
  await mkdir(join(directory, "acceptance"), { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "labels",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test", lint },
    }),
  );
  await writeFile(join(directory, "label.mjs"), base);
  await writeFile(join(directory, "legacy.mjs"), legacy);
  await writeFile(join(directory, "label.test.mjs"), suite);
  await writeFile(join(directory, "prettier-like.mjs"), prettierLike);
  await writeFile(join(directory, "eslint-like.mjs"), eslintLike);
  await writeFile(join(directory, "acceptance", "check.mjs"), check);
  if (swarmToml !== undefined) await writeFile(join(directory, "swarm.toml"), swarmToml);
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

const write = (path: string, content: string): ScriptedTurn => ({
  toolCalls: [{ name: "write", input: { path, content } }],
});
const declare = (files: readonly string[]): ScriptedTurn => ({
  toolCalls: [{ name: "declare_file_set", input: { files } }],
});

interface Result {
  readonly bundleDirectory?: string;
  readonly exitCode?: number;
  readonly verdict?: {
    readonly acceptable?: boolean;
    readonly inherited?: readonly { gateId: string; failures: readonly string[] }[];
    readonly reasons?: Record<string, string>;
  };
  readonly outcome?: {
    readonly status?: string;
    readonly checks?: {
      readonly result: string;
      readonly inherited: readonly { gateId: string; failures: readonly string[] }[];
    };
    readonly finalVerification?: { readonly regression?: string } | null;
    readonly interventions?: { readonly repairAttempts?: number };
  };
}

async function swarm(
  turns: readonly ScriptedTurn[],
  lint = "node prettier-like.mjs",
  swarmToml?: string,
): Promise<{ result: Result; code: number; stdout: string; directory: string }> {
  let worker = 0;
  const endpoint = await startScriptedEndpoint({
    modelId: "stub",
    turns: Array.from({ length: 60 }, () => () => turns[worker++] ?? { text: "Done." }),
  });
  endpoints.push(endpoint);
  const prepared = await workspace(lint, swarmToml);
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
    .map((one) => JSON.parse(one) as { type?: string } & Result)
    .find((one) => one.type === undefined && one.bundleDirectory !== undefined);
  return { result: line ?? {}, code, stdout, directory: prepared.directory };
}

/** The bundle's own verifier and re-deriver, run as a reviewer runs them. */
async function independentlyChecked(bundle: string): Promise<string> {
  const verified = await run(process.execPath, [join(bundle, "verify.mjs"), bundle]).then(
    (ran) => ({ code: 0, stdout: ran.stdout }),
    (failed: { code?: number; stdout?: string }) => ({
      code: failed.code ?? 1,
      stdout: failed.stdout ?? "",
    }),
  );
  expect(verified.code, verified.stdout.slice(-3000)).toBe(0);
  const rederived = await run(process.execPath, [join(bundle, "rederive.mjs"), bundle]);
  expect(rederived.stdout).not.toMatch(/DISAGREES/);
  return verified.stdout;
}

describe("a static check the base already fails, held to no new regression", () => {
  it("accepts a change that leaves exactly the base's failure, says it remains, and the bundle re-derives it", async () => {
    const { result, code, stdout } = await swarm([
      declare(["label.mjs"]),
      write("label.mjs", correct),
    ]);
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(code).toBe(0);
    expect(result.outcome?.checks).toEqual({
      result: "no-new-failures",
      inherited: [{ gateId: "lint", failures: ["prettier legacy.mjs"] }],
    });
    expect(stdout).toContain(
      "accepted: no new failures established; these inherited failures remain: lint (prettier legacy.mjs)",
    );
    // No attempt was spent on the base's own failure.
    expect(result.outcome?.interventions?.repairAttempts).toBe(0);
    // The final verification reads the same failure the same way.
    expect(result.outcome?.finalVerification?.regression).toBe("pass");
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("refuses a change that adds a failure of its own, naming it, after the repair leaves it", async () => {
    const { result, code, stdout } = await swarm([
      declare(["label.mjs"]),
      write("label.mjs", `${marker}\n${correct}`),
    ]);
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("not-accepted");
    expect(code).toBe(1);
    expect(result.verdict?.acceptable).toBe(false);
    expect(result.verdict?.reasons?.assessment).toContain("blocking gate(s) failed: lint");
    expect(result.outcome?.interventions?.repairAttempts).toBeGreaterThan(0);
    // The repair was told which finding is new, and that the base's is not its to fix.
    expect(stdout).not.toContain('"result":"no-new-failures"');
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("does not let fixing the base's failure pay for a new one at the same count", async () => {
    const { result, stdout } = await swarm([
      declare(["label.mjs", "legacy.mjs"]),
      write("legacy.mjs", legacy.replace(`${marker}\n`, "")),
      write("label.mjs", `${marker}\n${correct}`),
    ]);
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("not-accepted");
    expect(result.verdict?.acceptable).toBe(false);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("accepts a change that also fixes the base's failure as all required checks passing", async () => {
    const { result, directory, stdout } = await swarm([
      declare(["label.mjs", "legacy.mjs"]),
      write("legacy.mjs", legacy.replace(`${marker}\n`, "")),
      write("label.mjs", correct),
    ]);
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("accepted");
    expect(result.outcome?.checks).toEqual({ result: "all-required-pass", inherited: [] });
    expect(readFileSync(join(directory, "legacy.mjs"), "utf8")).not.toContain(marker);
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);

  it("establishes no inheritance from a chained command that stopped before its last command ran, and says so before any model work", async () => {
    // ESLint's stand-in fails on the base, so the formatter after it never runs there, and would
    // never run on any change that keeps that failure: whatever a change did to formatting is
    // unobserved. The run's own preflight reads the check as unmeasurable and stops before the
    // model is asked for anything, rather than accepting a change no check could compare.
    const { result, code, stdout } = await swarm(
      [declare(["label.mjs"]), write("label.mjs", `${marker}\n${correct}`)],
      "node eslint-like.mjs && node prettier-like.mjs",
    );
    expect(code).not.toBe(0);
    expect(result.verdict).toBeUndefined();
    expect(stdout).toContain(
      "lint (a run did not report completely (cut short, cancelled, short of its plan, or a chained command stopped before the last one ran))",
    );
    expect(stdout).toContain("before model spending");
  }, 240_000);
});

describe("a check that must pass outright", () => {
  it("still refuses the base's own failure where swarm.toml asks for an absolute pass", async () => {
    const { result, code, stdout } = await swarm(
      [declare(["label.mjs"]), write("label.mjs", correct)],
      "node prettier-like.mjs",
      '[gates]\nlint = { command = "node prettier-like.mjs", requirement = "absolute-pass" }\n',
    );
    expect(result.outcome?.status, stdout.slice(-3000)).toBe("not-accepted");
    expect(code).toBe(1);
    expect(result.verdict?.reasons?.assessment).toContain("blocking gate(s) failed: lint");
    await independentlyChecked(result.bundleDirectory ?? "");
  }, 240_000);
});
