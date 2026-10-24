/**
 * The two failure-attribution gaps, a formatting control and the requested-static-repair boundary,
 * through the ordinary command line with real ESLint and Prettier and a scripted model.
 *
 *   node real-tools.mts --repo <checkout> --eslint <dir of an eslint 8 install> \
 *     --prettier <dir of a prettier 3 install> --out <result.json>
 *
 * The scripted model only writes the files each case names. What is measured is what the
 * product's gates, run assessment, final verification and bundle verifier make of that change.
 * Development evidence: the cases were written to show the defects, not drawn from a study.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";

const run = promisify(execFile);
const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    eslint: { type: "string" },
    prettier: { type: "string" },
    out: { type: "string" },
    only: { type: "string" },
  },
});
const repo = values.repo as string;
const { startScriptedEndpoint } = (await import(
  join(repo, "src/providers/scripted-endpoint.ts")
)) as typeof import("../../../../src/providers/scripted-endpoint.ts");

const eslintFlags =
  "--no-eslintrc --ext .js,.mjs --parser-options=ecmaVersion:2022 --parser-options=sourceType:module --rule no-var:error";
const base = "export function label(name) {\n  return name.trim() + ':';\n}\n";
const correct =
  "export function label(name, options = {}) {\n  const text = name.trim() + ':';\n  return options.upper ? text.toUpperCase() : text;\n}\n";
const legacy = "// Kept as it was.\nvar legacy = 1;\nexport { legacy };\n";
const suite =
  "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { label } from '../src/label.mjs';\ntest('a name gets a colon', () => assert.equal(label('bob'), 'bob:'));\n";
const check =
  "import assert from 'node:assert/strict';\nimport { label } from '../src/label.mjs';\nassert.equal(label('ann', { upper: true }), 'ANN:');\nassert.equal(label('bob'), 'bob:');\n";
const task =
  "Add an `upper` option to label(name, options) in src/label.mjs: with { upper: true } the label is upper-case, so label('ann', { upper: true }) gives 'ANN:'. Without the option, label(name) behaves as it does today.";

interface Case {
  readonly id: string;
  readonly lint: string;
  readonly task: string;
  readonly legacy: string;
  /** The scripted change: files to declare, then files to write. */
  readonly writes: Readonly<Record<string, string>>;
  readonly meaning: string;
}

const cases: readonly Case[] = [
  {
    id: "A-chain-same-tool",
    lint: `eslint ${eslintFlags} src && eslint ${eslintFlags} test`,
    task,
    legacy,
    writes: {
      "src/label.mjs": correct,
      "test/extra.test.mjs": "import { test } from 'node:test';\nvar unused = 1;\ntest('extra', () => {});\n",
    },
    meaning:
      "the base fails `eslint src`, so `eslint test` never runs on either tree; the change adds a `var` under test/ that no command observed",
  },
  {
    id: "B-same-rule-moved",
    lint: `eslint ${eslintFlags} src`,
    task: `${task} You may tidy src/legacy.mjs.`,
    legacy,
    writes: {
      "src/label.mjs": correct,
      "src/legacy.mjs":
        "// Kept as it was.\nlet legacy = 1;\nexport { legacy };\n\nexport function later() {\n  var count = 2;\n  return count;\n}\n",
    },
    meaning:
      "the change fixes the base's no-var error on line 2 and adds an identical no-var error on line 6 of the same file",
  },
  {
    id: "C-prettier-in-failing-file",
    lint: "prettier --check src",
    task: `${task} You may tidy src/legacy.mjs.`,
    legacy: "// Kept as it was.\nconst legacy    = 1;\nexport { legacy };\n",
    writes: {
      "src/label.mjs": correct,
      "src/legacy.mjs":
        "// Kept as it was.\nconst legacy    = 1;\nexport { legacy };\nexport const    other =  [1,2,3];\n",
    },
    meaning:
      "the base fails Prettier on src/legacy.mjs; the change edits that file and adds a second unformatted statement to it",
  },
  {
    id: "D-requested-static-repair",
    lint: `eslint ${eslintFlags} src`,
    task: `Fix the ESLint error in src/legacy.mjs. ${task}`,
    legacy,
    writes: { "src/label.mjs": correct },
    meaning:
      "the task asks for the base's ESLint error to be fixed; the change leaves it and adds the option",
  },
  {
    id: "E-inherited-control",
    lint: `eslint ${eslintFlags} src`,
    task,
    legacy,
    writes: { "src/label.mjs": correct },
    meaning: "the change leaves the base's ESLint error exactly as it was: a correct acceptance",
  },
];

async function git(cwd: string, ...args: string[]) {
  return (
    await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd })
  ).stdout.trim();
}

async function prepare(scratch: string, one: Case) {
  const directory = join(scratch, "workspace");
  for (const sub of ["src", "test", "acceptance", "bin"])
    await mkdir(join(directory, sub), { recursive: true });
  // The real tools, each behind a committed launcher named after it, so the fresh checkouts the
  // final verification makes run the same programs without an install, and the script npm echoes
  // names each command by its tool, as `eslint ...` in an installed project does.
  const launcher = (entry: string) => `#!/bin/sh\nexec node ${JSON.stringify(entry)} "$@"\n`;
  await writeFile(join(directory, "bin/eslint"), launcher(join(values.eslint as string, "bin/eslint.js")), {
    mode: 0o755,
  });
  await writeFile(
    join(directory, "bin/prettier"),
    launcher(join(values.prettier as string, "bin/prettier.cjs")),
    { mode: 0o755 },
  );
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "labels",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test", lint: one.lint.replace(/(^|&& )(eslint|prettier) /g, "$1bin/$2 ") },
    }),
  );
  await writeFile(join(directory, "src/label.mjs"), base);
  await writeFile(join(directory, "src/legacy.mjs"), one.legacy);
  await writeFile(join(directory, "test/label.test.mjs"), suite);
  await writeFile(join(directory, "acceptance/check.mjs"), check);
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

async function launch(one: Case) {
  const scratch = await mkdtemp(join(tmpdir(), "swarm-attribution-repro-"));
  const home = join(scratch, "home");
  await mkdir(home, { recursive: true });
  const turns = [
    { toolCalls: [{ name: "declare_file_set", input: { files: Object.keys(one.writes) } }] },
    ...Object.entries(one.writes).map(([path, content]) => ({
      toolCalls: [{ name: "write", input: { path, content } }],
    })),
  ];
  let next = 0;
  const endpoint = await startScriptedEndpoint({
    modelId: "stub",
    turns: Array.from({ length: 60 }, () => () => turns[next++] ?? { text: "Done." }),
  });
  const prepared = await prepare(scratch, one);
  let stdout = "";
  let code = 0;
  try {
    const ran = await run(
      process.execPath,
      [
        join(repo, "src/cli.ts"),
        one.task,
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
        timeout: 300_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    stdout = `${ran.stdout}\n${ran.stderr}`;
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    code = failed.code ?? 1;
    stdout = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
  } finally {
    await endpoint.close();
  }
  const result = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((line) => line.type === undefined && line.bundleDirectory !== undefined) as
    | {
        bundleDirectory?: string;
        verdict?: { acceptable?: boolean; reasons?: Record<string, string> };
        outcome?: {
          status?: string;
          checks?: unknown;
          finalVerification?: { regression?: string } | null;
        };
      }
    | undefined;
  let verifier: string | null = null;
  if (result?.bundleDirectory !== undefined) {
    verifier = await run(process.execPath, [
      join(result.bundleDirectory, "verify.mjs"),
      result.bundleDirectory,
    ]).then(
      () => "verifies",
      (failed: { stdout?: string }) => `fails: ${(failed.stdout ?? "").slice(-400)}`,
    );
  }
  const preflight = /before model spending[^\n]*/.exec(stdout)?.[0] ?? null;
  if (process.env.REPRO_DUMP === "1") console.error(stdout.slice(-6000));
  if (process.env.REPRO_KEEP !== "1") await rm(scratch, { recursive: true, force: true });
  return {
    case: one.id,
    meaning: one.meaning,
    lint: one.lint,
    exitCode: code,
    status: result?.outcome?.status ?? null,
    acceptable: result?.verdict?.acceptable ?? null,
    checks: result?.outcome?.checks ?? null,
    finalRegression: result?.outcome?.finalVerification?.regression ?? null,
    assessment: result?.verdict?.reasons?.assessment ?? null,
    preflight,
    lintLines: stdout
      .split("\n")
      .filter((line) => /lint \(|inherited|unattributed|newly failing/.test(line))
      .slice(0, 6),
    verifier,
  };
}

const results = [];
for (const one of cases.filter((c) => values.only === undefined || c.id.startsWith(values.only))) {
  const outcome = await launch(one);
  console.log(JSON.stringify(outcome));
  results.push(outcome);
}
if (values.out !== undefined)
  await writeFile(values.out, `${JSON.stringify({ repo, results }, null, 2)}\n`);
