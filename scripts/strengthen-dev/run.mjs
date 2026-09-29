#!/usr/bin/env node
/**
 * A development run of check strengthening and implementation repair with a real local model.
 *
 * The fixture is the one the integration test uses: a requirement that `clamp` bounds a number to a
 * range, a check that only tests the middle of it (so it accepts the tree before the work), a
 * candidate that implemented the floor and forgot the ceiling, and a sealed reference. The model
 * proposes the additive check; the harness admits it only on its own probe runs; the coding path
 * repairs the candidate under the revised contract; the final verification judges the exact tree
 * against every original and admitted check, and the bundle's own verifier re-derives all of it.
 * Development evidence, labelled as such: it validates the mechanism, it measures nothing about
 * how often the mechanism helps.
 *
 *   node scripts/strengthen-dev/run.mjs <output directory> [--model local:<id>] [--endpoint <url>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runAgentTask } from "../../src/agent-run.ts";
import { writeBundle } from "../../src/cli-bundle.ts";
import { resolveLocalBackend } from "../../src/cli-local-backend.ts";
import { registrySettingsFrom } from "../../src/cli-provider-settings.ts";
import { settingsFor } from "../../src/cli-run-settings.ts";
import { createSystemClock, createSystemRandom } from "../../src/cli-runtime-inputs.ts";
import { strengthenAndRepair, strengtheningLimits, tokensSpent } from "../../src/cli-strengthen.ts";
import { presetTaskContract } from "../../src/cli-task-contract.ts";
import { probeVerifier, taskGoalGate, verifyCandidateUnder } from "../../src/cli-task-goal.ts";
import { declareGoalContract } from "../../src/evidence/goal-contract.ts";
import { createRecordingModelClient } from "../../src/evidence/model-call-recording.ts";
import {
  createSessionId,
  defaultSessionRoot,
  openEvidenceSession,
} from "../../src/evidence/session.ts";
import { defaultDiffBudget, sealAssembledCriteria } from "../../src/gates/engine.ts";
import { createFileSetRegistry } from "../../src/gates/file-set.ts";
import { parseModelSpec } from "../../src/providers/model-spec.ts";
import { createProviderRegistry } from "../../src/providers/registry.ts";

const args = process.argv.slice(2);
const output = args[0];
if (!output) {
  console.error("usage: run.mjs <output directory> [--model local:<id>] [--endpoint <url>]");
  process.exit(2);
}
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const modelSpec = flag("--model", "local:qwen3.6:35b-a3b");
const endpoint = flag("--endpoint", "http://127.0.0.1:11434/v1");
mkdirSync(output, { recursive: true });

const repository = mkdtempSync(join(tmpdir(), "swarm-strengthen-dev-"));
const git = (...words) =>
  execFileSync("git", ["-c", "user.name=dev", "-c", "user.email=dev@example.test", ...words], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
const write = (path, content) => writeFileSync(join(repository, path), content);
git("init", "-q");
write(
  "package.json",
  '{"name":"clamp","private":true,"type":"module","scripts":{"test":"node --test"}}\n',
);
write("clamp.mjs", "export function clamp(n, lo, hi) {\n  return n;\n}\n");
write(
  "clamp.test.mjs",
  'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "./clamp.mjs";\ntest("keeps the middle", () => assert.equal(clamp(5, 0, 10), 5));\n',
);
git("add", "-A");
git("commit", "-qm", "clamp returns its input");
const base = git("rev-parse", "HEAD");
write(
  "clamp.mjs",
  "export function clamp(n, lo, hi) {\n  return Math.min(Math.max(n, lo), hi);\n}\n",
);
const reference = `${git("diff")}\n`;
git("checkout", "--", ".");
// The candidate: the floor implemented and tested, the ceiling forgotten.
write(
  "clamp.mjs",
  "export function clamp(n, lo, hi) {\n  if (n < lo) return lo;\n  return n;\n}\n",
);
write(
  "clamp.test.mjs",
  'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "./clamp.mjs";\ntest("keeps the middle", () => assert.equal(clamp(5, 0, 10), 5));\ntest("raises to the floor", () => assert.equal(clamp(-1, 0, 10), 0));\n',
);

const contract = {
  version: 1,
  goal: "clamp a number to a range",
  requirements: [
    {
      id: "clamp-bounds",
      description: "clamp(n, lo, hi) returns n limited to the closed range from lo to hi",
      checks: ["clamp-middle"],
    },
  ],
  checks: [
    {
      id: "clamp-middle",
      command: "node --test acceptance/clamp-middle.test.mjs",
      author: "user",
      exposure: "shared",
      artifacts: [
        {
          path: "acceptance/clamp-middle.test.mjs",
          content:
            'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "../clamp.mjs";\ntest("middle", () => assert.equal(clamp(5, 0, 10), 5));\n',
        },
      ],
    },
  ],
  immutablePaths: [],
  challenges: {
    version: 1,
    mutations: "auto",
    fixtures: [],
    references: [
      {
        id: "min-max",
        requirement: "clamp-bounds",
        description: "the textbook implementation",
        patch: reference,
      },
    ],
  },
};

const clock = createSystemClock();
const random = createSystemRandom();
const evidence = await openEvidenceSession({
  root: defaultSessionRoot(homedir()),
  sessionId: createSessionId(clock, random),
  clock,
});
const goal = await declareGoalContract(evidence, contract);
const signal = new AbortController().signal;
const context = {
  contract: goal,
  workspace: repository,
  baseCommit: base,
  evidence,
  clock,
  signal,
  isolation: null,
  install: false,
  challengePolicy: "required",
};
// Sealed before the first model call with the acceptance gate, as the command's implementation
// run does; the repair then runs under this seal rather than writing a second one.
await sealAssembledCriteria({
  workspaceRoot: repository,
  criteriaRef: base,
  gateOptions: { acceptanceGate: taskGoalGate(context) },
  evidence,
  budgets: defaultDiffBudget,
  attemptCap: 1,
});
const settings = await settingsFor(repository, { model: modelSpec, localEndpoint: endpoint });
const spec = parseModelSpec(modelSpec);
const backend = await resolveLocalBackend(settings, [spec]);
const model = createRecordingModelClient(
  createProviderRegistry(registrySettingsFrom(settings, backend)).create(spec),
  evidence,
  { transcript: "components" },
);
const budget = 400_000;
const startedAt = clock.now();
const outcome = await strengthenAndRepair({
  evidence,
  workspace: repository,
  baseCommit: base,
  root: goal,
  policy: "required",
  limits: strengtheningLimits({}),
  model,
  clock,
  signal,
  deadline: startedAt + 45 * 60_000,
  reserveMs: 60_000,
  remainingTokens: () => {
    const used = tokensSpent(evidence);
    return used.unknown ? 0 : budget - used.spent;
  },
  verifyCandidate: (next, policy) => verifyCandidateUnder(context, next, policy),
  verifyProbe: probeVerifier(context),
  repair: async (brief, revised) => {
    await runAgentTask({
      task: "Make clamp satisfy its requirement: clamp(n, lo, hi) returns n limited to the closed range from lo to hi.",
      repairFeedback: brief,
      contract: presetTaskContract({
        goal: revised,
        task: "Make clamp satisfy its requirement.",
        maxSteps: 20,
        maxWallMs: 20 * 60_000,
        network: "unrestricted",
      }),
      workspace: repository,
      baseRef: base,
      maxSteps: 20,
      attempts: 1,
      criteriaSealed: true,
      maxTokens: Math.max(0, budget - tokensSpent(evidence).spent),
      model,
      evidence,
      fileSet: createFileSetRegistry(evidence),
      clock,
      random,
      emit: () => {},
      confirm: async () => "no",
      approvalMode: "auto",
      abortSignal: signal,
      homeDir: homedir(),
      gateOptions: { acceptanceGate: taskGoalGate({ ...context, contract: revised }) },
    });
  },
});
const final = await verifyCandidateUnder(context, outcome.contract, "required");
const bundle = await writeBundle(evidence, null, clock, () => {});
const verified = spawnSync(
  process.execPath,
  [join(bundle.directory, "verify.mjs"), bundle.directory],
  {
    encoding: "utf8",
  },
);
const summary = {
  label:
    "development run of check strengthening and repair with a local model; validates the mechanism, measures no effect",
  model: modelSpec,
  repository,
  base,
  rounds: outcome.rounds,
  admitted: outcome.admitted,
  stopped: outcome.stopped,
  finalContractChecks: outcome.contract.checks.map((check) => check.id),
  finalAccepted: final.goalAcceptance?.accepted ?? null,
  finalRegression: final.regression,
  finalChallenges:
    final.challenges?.requirements.map((one) => ({ id: one.id, outcome: one.outcome })) ?? null,
  finalClamp: execFileSync("cat", [join(repository, "clamp.mjs")], { encoding: "utf8" }),
  tokens: tokensSpent(evidence),
  wallMs: clock.now() - startedAt,
  bundle: bundle.directory,
  bundleVerify: { exit: verified.status, tail: verified.stdout.trim().split("\n").slice(-4) },
  strengtheningFindings: verified.stdout
    .split("\n")
    .filter((line) => /check strengthening|challenge verdict/.test(line)),
};
writeFileSync(join(resolve(output), "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
