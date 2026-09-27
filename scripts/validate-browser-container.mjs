import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSystemClock } from "../src/cli-runtime-inputs.ts";
import { declareGoalContract } from "../src/evidence/goal-contract.ts";
import { openEvidenceSession } from "../src/evidence/session.ts";
import { harnessChildEnvironment } from "../src/exec/child-environment.ts";
import { selfTestContainment } from "../src/exec/execution-mode.ts";
import { recordedContainerBackend } from "../src/exec/runtime-resource.ts";
import { verifyGoal } from "../src/gates/goal-acceptance.ts";
import { createNodeCommandRunner } from "../src/gates/node-command-runner.ts";

const root = await mkdtemp(join(homedir(), ".swarm/upgrade-validation/browser-"));
const containerRoot = join(root, "candidate");
const workspace = join(containerRoot, "project");
await mkdir(workspace, { recursive: true, mode: 0o700 });
const clock = createSystemClock();
const evidence = await openEvidenceSession({
  root: join(root, "sessions"),
  sessionId: "browser",
  clock,
});
const image = process.argv[2] ?? "swarm-upgrade-browser:20260927";
const backend = recordedContainerBackend(
  {
    runtime: "docker",
    image,
    workspaceRoot: workspace,
    user: `${process.getuid()}:${process.getgid()}`,
  },
  evidence,
);
const runner = createNodeCommandRunner(clock, harnessChildEnvironment(), backend);
const commands = {
  run: runner.run,
  async runVouched(argv, options) {
    const result = await runner.runVouched(argv, options);
    if (result.exitCode !== 0) console.error(JSON.stringify({ argv, ...result }));
    return result;
  },
};
console.error(`browser evidence: ${root}`);
await chmod(workspace, 0o700);
async function git(args) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: root },
      timeout: 30000,
    },
  );
  if (result.status !== 0) throw Error(result.stderr);
  return result.stdout.trim();
}
await writeFile(
  join(workspace, "package.json"),
  JSON.stringify({
    name: "swarm-browser-fixture",
    version: "1.0.0",
    type: "module",
    devDependencies: { "@playwright/test": "1.63.0" },
  }),
);
await writeFile(join(workspace, ".gitignore"), "node_modules/\ntest-results/\n.acceptance/\n");
await writeFile(
  join(workspace, "playwright.config.mjs"),
  "export default { testDir: '.acceptance', timeout:5000, use: { screenshot:'only-on-failure', trace:'retain-on-failure' } };\n",
);
const install = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: workspace,
  encoding: "utf8",
  env: { PATH: process.env.PATH, HOME: root },
  timeout: 120000,
});
if (install.status !== 0) throw Error(install.stderr);
await git(["init", "-q"]);
await writeFile(join(root, "canary"), "outside candidate boundary");
const envelope = await selfTestContainment(backend, {
  workspaceRoot: workspace,
  hostFileOutsideWorkspace: join(root, "canary"),
});
await evidence.record({
  type: "execution-envelope",
  actor: "harness",
  provenance: ["tool-output"],
  payload: JSON.parse(JSON.stringify(envelope)),
});
if (envelope.mode !== "isolated") throw Error(JSON.stringify(envelope));
const instrument =
  "import {test,expect} from '@playwright/test'; import {readFile} from 'node:fs/promises'; test('increments',async({page})=>{const app=await readFile(process.env.SWARM_SUBJECT_DIRECTORY+'/app.js','utf8');await page.setContent('<button>0</button><script>'+app+'<\\/script>');await page.getByRole('button').click();await expect(page.getByRole('button')).toHaveText('1',{timeout:300});});";
const contract = await declareGoalContract(evidence, {
  version: 1,
  goal: "Increment once",
  requirements: [
    { id: "increment", description: "Click changes zero to one", checks: ["interaction"] },
  ],
  checks: [
    {
      id: "interaction",
      command: "pinned Playwright interaction",
      author: "model",
      exposure: "withheld",
      artifacts: [{ path: ".acceptance/interaction.spec.mjs", content: instrument }],
      behavior: {
        kind: "browser",
        cwd: ".",
        timeoutMs: 30000,
        maxOutputBytes: 256000,
        toolchain: "@playwright/test@1.63.0",
        network: "inherit",
        environment: { PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" },
        expectedTests: 1,
        instrument: { source: instrument, titles: ["increments"] },
      },
    },
  ],
  immutablePaths: ["playwright.config.mjs"],
});
const results = [];
for (const value of [1, 2]) {
  await writeFile(
    join(workspace, "app.js"),
    `document.querySelector('button').onclick=()=>{document.querySelector('button').textContent='${value}'};\n`,
  );
  await git(["add", "--all"]);
  await git(["commit", "-qm", `application returns ${value}`]);
  const tree = await git(["rev-parse", "HEAD^{tree}"]);
  const result = await verifyGoal({
    contract,
    evidence,
    checkout: workspace,
    tree,
    commands,
    timeoutMs: 30000,
  });
  results.push({ value, tree, accepted: result.accepted });
  if (result.accepted !== (value === 1))
    throw Error(`wrong browser verdict for application ${value}`);
}
const artifacts = evidence
  .records()
  .filter((record) => record.type === "verification-command")
  .map((record) => evidence.payloads().get(record.payloadDigest))
  .filter((value) => value?.rule === "behavior-artifact-v1" && value?.data);
if (
  !artifacts.some((artifact) => artifact.contentType === "image/png") ||
  !artifacts.some((artifact) => artifact.contentType === "application/zip")
)
  throw Error("missing failure screenshots or traces");
await writeFile(
  join(root, "results.json"),
  JSON.stringify(
    {
      image,
      envelope,
      results,
      artifacts: artifacts.map(({ data, ...metadata }) => metadata),
      evidence: evidence.directory,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(JSON.stringify({ root, results, artifacts: artifacts.length, status: "passed" }));
