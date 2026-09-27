import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

if (process.argv[2] === "assert") {
  const expected = process.argv[3];
  const report = JSON.parse(readFileSync(process.env.SWARM_REPORT, "utf8"));
  const good = expected === "good";
  if (
    process.env.SWARM_STATUS !== (good ? "0" : "1") ||
    process.env.SWARM_OUTCOME !== (good ? "success" : "failure") ||
    report.verified !== good ||
    report.task !== (good ? "accepted" : "rejected") ||
    report.executionTrust !== "isolated" ||
    report.sourceIdentity.head !== process.env.SWARM_HEAD
  )
    throw Error("Action control disagrees with the pinned candidate's expected behavioral verdict");
  if (
    !readFileSync(join(process.env.SWARM_EVIDENCE, "summary.md"), "utf8").includes(
      "negative\\-input",
    )
  )
    throw Error("Action summary omitted requirement results");
  const verdict = JSON.parse(readFileSync(process.env.SWARM_VERDICT, "utf8"));
  if (
    process.env.SWARM_RESULT !== (good ? "verified" : "not-verified") ||
    verdict.decision.result !== process.env.SWARM_RESULT ||
    verdict.head !== process.env.SWARM_HEAD ||
    verdict.policy.isolation !== "docker"
  )
    throw Error("verdict document disagrees with the verifier's result or the pinned head");
  // A push event has no pull request, so no comment; the verdict is signed all the same.
  if (process.env.SWARM_COMMENT !== "skipped") throw Error("a push run must not publish a comment");
  if (process.env.SWARM_ATTESTATION !== "signed")
    throw Error(`the verdict was not signed on this run (${process.env.SWARM_ATTESTATION})`);
  if (!existsSync(join(process.env.SWARM_EVIDENCE, "attestation", "verdict.sigstore.json")))
    throw Error("the signed attestation bundle was not retained beside the evidence");
  console.log(`Trusted ${expected} control confirmed verifier status ${process.env.SWARM_STATUS}.`);
} else {
  const root = mkdtempSync(join(process.env.RUNNER_TEMP, "swarm-control-"));
  const workspace = join(root, "candidate");
  mkdirSync(workspace, { mode: 0o700 });
  const git = (args) => {
    const result = spawnSync(
      "git",
      ["-c", "user.name=Swarm fixture", "-c", "user.email=fixture@example.test", ...args],
      {
        cwd: workspace,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: root },
        timeout: 30000,
      },
    );
    if (result.status !== 0) throw Error(result.stderr);
    return result.stdout.trim();
  };
  writeFileSync(
    join(workspace, "package.json"),
    JSON.stringify({
      name: "action-control",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  writeFileSync(
    join(workspace, "clamp.test.mjs"),
    "import {test} from 'node:test';import assert from 'node:assert/strict';import {clamp} from './clamp.mjs';test('positive',()=>assert.equal(clamp(3),3));\n",
  );
  writeFileSync(join(workspace, "clamp.mjs"), "export const clamp = n => n;\n");
  git(["init", "-q"]);
  git(["add", "--all"]);
  git(["commit", "-qm", "base control"]);
  const base = git(["rev-parse", "HEAD"]);
  writeFileSync(
    join(workspace, "clamp.mjs"),
    process.argv[2] === "good"
      ? "export const clamp = n => Math.max(0,n);\n"
      : "export const clamp = n => n < 0 ? 7 : n;\n",
  );
  git(["commit", "-qam", "behavior control"]);
  const head = git(["rev-parse", "HEAD"]);
  const contract = join(root, "goal.json");
  writeFileSync(
    contract,
    JSON.stringify({
      version: 1,
      goal: "Clamp negative inputs",
      preset: { kind: "bugfix", reproducer: "negative" },
      requirements: [
        { id: "negative-input", description: "negative inputs return zero", checks: ["negative"] },
      ],
      checks: [
        {
          id: "negative",
          command: "generated CLI acceptance instrument",
          author: "model",
          exposure: "withheld",
          artifacts: [],
          behavior: {
            kind: "cli",
            cwd: ".",
            timeoutMs: 3000,
            maxOutputBytes: 4000,
            toolchain: "Node 24",
            network: "inherit",
            argv: [
              "node",
              "--input-type=module",
              "-e",
              "import {clamp} from './clamp.mjs';console.log(clamp(-1))",
            ],
            exitCode: 0,
            stdout: [{ kind: "equals", value: "0\n" }],
            stderr: [],
          },
        },
      ],
      immutablePaths: ["clamp.test.mjs"],
    }),
  );
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `workspace=${workspace}\nbase=${base}\nhead=${head}\ncontract=${contract}\n`,
  );
}
