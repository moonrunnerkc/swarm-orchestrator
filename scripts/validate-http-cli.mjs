import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(homedir(), ".swarm/upgrade-validation/http-cli-"));
const workspace = join(root, "candidate");
mkdirSync(workspace, { mode: 0o700 });
const observations = [];
function run(file, args, expected = 0) {
  const result = spawnSync(file, args, {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: root, NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 8000000,
  });
  observations.push({
    file,
    args,
    expected,
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  writeFileSync(join(root, "observations.json"), JSON.stringify(observations, null, 2), {
    mode: 0o600,
  });
  if (result.status !== expected)
    throw Error(
      `HTTP fixture ${root}: expected ${expected}, got ${result.status}: ${result.stderr}`,
    );
  return result.stdout;
}
const git = (...args) =>
  run("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args]).trim();
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
const server = (value) =>
  `import {createServer} from 'node:http';createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({value:${value}}));}).listen(${port},'127.0.0.1');\n`;
writeFileSync(
  join(workspace, "package.json"),
  JSON.stringify({ type: "module", scripts: { test: "node --test runtime.test.mjs" } }),
);
writeFileSync(
  join(workspace, "runtime.test.mjs"),
  "import {test} from 'node:test';import assert from 'node:assert/strict';test('runtime',()=>assert.equal(1+1,2));\n",
);
writeFileSync(join(workspace, "server.mjs"), server(1));
git("init", "-q");
git("add", "--all");
git("commit", "-qm", "base service");
const base = git("rev-parse", "HEAD");
const goal = join(root, "goal.json");
writeFileSync(
  goal,
  JSON.stringify({
    version: 1,
    goal: "Keep response value one",
    preset: { kind: "refactor" },
    requirements: [
      { id: "value", description: "POST /value returns value one", checks: ["response"] },
    ],
    checks: [
      {
        id: "response",
        command: "pinned HTTP response",
        author: "model",
        exposure: "withheld",
        artifacts: [],
        behavior: {
          kind: "http",
          cwd: ".",
          timeoutMs: 5000,
          maxOutputBytes: 16000,
          toolchain: "Node 24 HTTP",
          network: "inherit",
          server: ["node", "server.mjs"],
          port,
          readinessPath: "/ready",
          readinessTimeoutMs: 2000,
          request: {
            method: "POST",
            path: "/value",
            headers: { "content-type": "application/json" },
            body: "{}",
            timeoutMs: 1000,
          },
          status: 200,
          headers: { "content-type": "application/json" },
          body: [],
          json: [{ path: ["value"], equals: 1 }],
        },
      },
    ],
    immutablePaths: ["package.json", "runtime.test.mjs"],
  }),
);
for (const value of [1, 2]) {
  writeFileSync(join(workspace, "server.mjs"), `// Candidate service\n${server(value)}`);
  git("commit", "-qam", `response value ${value}`);
  for (const binary of [
    process.argv[2] ?? resolve("dist/cli.js"),
    process.argv[3] ?? resolve("packages/swarm-verify/dist/swarm-verify.js"),
  ]) {
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
          goal,
          "--json",
        ],
        value === 1 ? 0 : 1,
      ),
    );
    if (report.regression !== "pass" || report.task !== (value === 1 ? "accepted" : "rejected"))
      throw Error(`wrong HTTP verdict: ${root}`);
    const offline = run(process.execPath, [
      join(report.bundleDirectory, "verify.mjs"),
      report.bundleDirectory,
    ]);
    if (!offline.includes("bundle verified: every check passed"))
      throw Error(`offline HTTP derivation failed: ${root}`);
    const free = createServer();
    await new Promise((resolve, reject) => {
      free.once("error", reject);
      free.listen(port, "127.0.0.1", resolve);
    });
    await new Promise((resolve, reject) =>
      free.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
console.log(JSON.stringify({ root, observations: observations.length, status: "passed" }));
