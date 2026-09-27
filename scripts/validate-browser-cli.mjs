import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(homedir(), ".swarm/upgrade-validation/browser-cli-"));
const workspace = join(root, "candidate");
mkdirSync(workspace, { mode: 0o700 });
const outcomes = [];
const run = (file, args, expected = 0) => {
  const result = spawnSync(file, args, {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: homedir(), NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8000000,
  });
  outcomes.push({
    file,
    args,
    expected,
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  writeFileSync(join(root, "observations.json"), JSON.stringify(outcomes, null, 2), {
    mode: 0o600,
  });
  if (result.status !== expected)
    throw Error(
      `browser CLI evidence ${root}: expected ${expected}, got ${result.status}: ${result.stderr}`,
    );
  return result.stdout;
};
const git = (...args) =>
  run("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args]).trim();
writeFileSync(
  join(workspace, "package.json"),
  JSON.stringify({
    type: "module",
    scripts: { test: "node --test runtime.test.mjs" },
    devDependencies: { "@playwright/test": "1.63.0" },
  }),
);
writeFileSync(
  join(workspace, "runtime.test.mjs"),
  "import {test} from 'node:test';import assert from 'node:assert/strict';test('runtime',()=>assert.equal(1+1,2));\n",
);
writeFileSync(
  join(workspace, "playwright.config.mjs"),
  "throw new Error('candidate config must never execute');\n",
);
writeFileSync(
  join(workspace, "app.js"),
  "document.querySelector('button').onclick=()=>{document.querySelector('button').textContent='1'};\n",
);
git("init", "-q");
git("add", "--all");
git("commit", "-qm", "base interaction");
const base = git("rev-parse", "HEAD");
const contract = join(root, "goal.json");
writeFileSync(
  contract,
  JSON.stringify({
    version: 1,
    goal: "One click increments once",
    preset: { kind: "refactor" },
    requirements: [
      { id: "increment", description: "Click changes zero to one", checks: ["interaction"] },
    ],
    checks: [
      {
        id: "interaction",
        command: "pinned generated interaction",
        author: "model",
        exposure: "withheld",
        artifacts: [
          {
            path: ".acceptance/interaction.spec.mjs",
            content:
              "import {test,expect} from '/opt/swarm-browser/node_modules/@playwright/test/index.mjs';import {readFile} from 'node:fs/promises';test('increments',async({page})=>{const app=await readFile(process.env.SWARM_SUBJECT_DIRECTORY+'/app.js','utf8');await page.setContent('<button>0</button><script>'+app+'<\\/script>');await page.getByRole('button').click();await expect(page.getByRole('button')).toHaveText('1',{timeout:300});});",
          },
        ],
        behavior: {
          kind: "browser",
          cwd: ".",
          timeoutMs: 30000,
          maxOutputBytes: 256000,
          toolchain: "@playwright/test@1.63.0 in prepared image",
          network: "inherit",
          environment: { PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" },
          expectedTests: 1,
          instrument: {
            source:
              "import {test,expect} from '/opt/swarm-browser/node_modules/@playwright/test/index.mjs';import {readFile} from 'node:fs/promises';test('increments',async({page})=>{const app=await readFile(process.env.SWARM_SUBJECT_DIRECTORY+'/app.js','utf8');await page.setContent('<button>0</button><script>'+app+'<\\/script>');await page.getByRole('button').click();await expect(page.getByRole('button')).toHaveText('1',{timeout:300});});",
            titles: ["increments"],
          },
        },
      },
    ],
    immutablePaths: ["playwright.config.mjs", "runtime.test.mjs", "package.json"],
  }),
);
const binaries = [
  process.argv[2] ?? resolve("dist/cli.js"),
  process.argv[3] ?? resolve("packages/swarm-verify/dist/swarm-verify.js"),
];
for (const value of [1, 2]) {
  writeFileSync(
    join(workspace, "app.js"),
    `document.querySelector('button').onclick = () => { document.querySelector('button').textContent = '${value}'; };\n`,
  );
  git("commit", "-qam", `interaction returns ${value}`);
  for (const binary of binaries) {
    const report = JSON.parse(
      run(
        process.execPath,
        [
          binary,
          "ci",
          "--workspace",
          workspace,
          "--base",
          base,
          "--branch",
          "HEAD",
          "--goal-contract",
          contract,
          "--isolation",
          "docker:swarm-upgrade-browser:20260927",
          "--require-isolation",
          "--json",
        ],
        value === 1 ? 0 : 1,
      ),
    );
    if (
      report.task !== (value === 1 ? "accepted" : "rejected") ||
      report.executionTrust !== "isolated" ||
      report.regression !== "pass"
    )
      throw Error(`incorrect browser control: ${root}`);
    const offline = run(
      process.execPath,
      [join(report.bundleDirectory, "verify.mjs"), report.bundleDirectory],
      0,
    );
    if (
      !offline.includes("bundle verified: every check passed") ||
      !offline.includes("independent goal")
    )
      throw Error(`offline browser derivation failed: ${root}`);
    if (
      value === 2 &&
      !readFileSync(join(report.bundleDirectory, "ledger.jsonl"), "utf8").includes("goal-check")
    )
      throw Error("failure evidence missing");
  }
}
console.log(JSON.stringify({ root, observations: outcomes.length, status: "passed" }));
