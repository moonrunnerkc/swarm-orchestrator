import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { runAgentTask } from "../../src/agent-run.ts";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { containerClientEnvironment } from "../../src/exec/container-backend.ts";
import { recordedContainerBackend } from "../../src/exec/runtime-resource.ts";
import { createFileSetRegistry } from "../../src/gates/file-set.ts";
import { verifyIndependently } from "../../src/gates/independent-verification.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";
import { pathsInPatch } from "../../src/gates/patch-paths.ts";
import { diffAgainstBase } from "../../src/gates/scratch-index.ts";
import { testSource } from "./cases.mjs";
import { campaignRoot, clock, exportSession, image, record, session } from "./evidence.mjs";
import { modelClient, models, parseModelJson, sourceResponseSchema } from "./model.mjs";

export function backend(workspace, evidence) {
  return recordedContainerBackend(
    {
      runtime: "docker",
      image,
      workspaceRoot: workspace,
      user: `${process.getuid()}:${process.getgid()}`,
      sessionId: evidence.sessionId,
    },
    evidence,
  );
}

export async function workspaceFor(one, id) {
  // Agent work must stay outside the evidence root that its own policy correctly denies.
  const root = join(homedir(), ".swarm-evaluation-work-2026-09-11");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(join(root, `${id}-`));
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({ type: "module", scripts: { test: "node --test --test-reporter=tap" } }),
  );
  await writeFile(
    join(workspace, "solution.mjs"),
    "export function solve(input) { return null; }\n",
  );
  await writeFile(join(workspace, "solution.test.mjs"), testSource(one.publicChecks));
  for (const argv of [
    ["init", "--quiet"],
    ["config", "user.name", "Swarm evaluation"],
    ["config", "user.email", "evaluation@example.invalid"],
    ["add", "."],
    ["commit", "--quiet", "-m", "Frozen synthetic task base"],
  ])
    execFileSync("git", argv, {
      cwd: workspace,
      env: harnessChildEnvironment().variables,
      timeout: 10000,
    });
  return workspace;
}

export function frozenBase(workspace) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
    encoding: "utf8",
    env: harnessChildEnvironment().variables,
    timeout: 10000,
  }).trim();
}

export async function readCampaignSource(workspace) {
  const file = await open(
    join(workspace, "solution.mjs"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > 30000)
      throw new Error("solution.mjs must be a regular file of at most 30000 bytes");
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

/** Expected answers remain in the host observer, never mounted beside candidate code. */
export async function checkVectors(evidence, source, checks, label) {
  const root = join(campaignRoot, "observations");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(join(root, "check-"));
  await writeFile(join(workspace, "solution.mjs"), source);
  await writeFile(
    join(workspace, "invoke.mjs"),
    "import {solve} from './solution.mjs';process.stdout.write(JSON.stringify(solve(JSON.parse(process.argv[2]))));\n",
  );
  const inputs = checks.map((entry) => entry.input);
  const program = `import {spawnSync} from 'node:child_process';const inputs=${JSON.stringify(inputs)};const observations=inputs.map(input=>{const ran=spawnSync(process.execPath,['invoke.mjs',JSON.stringify(input)],{timeout:2000,maxBuffer:100000,env:{PATH:'/usr/local/bin:/usr/bin:/bin'}});return {exitCode:ran.status,stdout:ran.stdout?.toString()??'',stderr:ran.stderr?.toString()??'',error:ran.error?.message??null};});process.stdout.write(JSON.stringify(observations));`;
  await writeFile(join(workspace, "observe.mjs"), program);
  const ran = await backend(workspace, evidence).run(["node", "observe.mjs"], {
    cwd: workspace,
    timeoutMs: 30000,
  });
  let status = "unavailable";
  let matches = [];
  try {
    const observations = z
      .array(
        z.object({
          exitCode: z.number().nullable(),
          stdout: z.string(),
          stderr: z.string(),
          error: z.string().nullable(),
        }),
      )
      .length(checks.length)
      .parse(JSON.parse(ran.stdout));
    if (ran.exitCode === 0 && !ran.truncated && !ran.timedOut) {
      matches = observations.map((entry, index) => {
        if (entry.exitCode !== 0 || entry.error !== null) return false;
        try {
          return isDeepStrictEqual(JSON.parse(entry.stdout), checks[index].expected);
        } catch {
          return false;
        }
      });
      status = observations.some((entry) => entry.exitCode !== 0 || entry.error !== null)
        ? "unavailable"
        : matches.every(Boolean)
          ? "passed"
          : "assertion-failed";
    }
  } catch {
    /* Malformed output cannot become an accepted observation. */
  }
  const evidenceDigest = await record(evidence, "external-vector-check", {
    label,
    sourceDigest: digestOfBytes(source),
    checks,
    ran,
    matches,
    status,
  });
  return { status, evidenceDigest, matches };
}

export async function verifySource(evidence, one, source, label, produced) {
  const workspace = produced?.workspace ?? (await workspaceFor(one, label));
  const baseCommit = produced?.baseCommit ?? frozenBase(workspace);
  if (produced === undefined) await writeFile(join(workspace, "solution.mjs"), source);
  const patch = await diffAgainstBase({ workspaceRoot: workspace, baseRef: baseCommit });
  const preparation = createNodeCommandRunner(clock, harnessChildEnvironment());
  const checked = await verifyIndependently({
    repositoryRoot: workspace,
    checkoutRoot: evidence.directory,
    baseCommit,
    patch,
    commands: preparation,
    commandsForCheckout: async (checkout) => {
      const commands = createNodeCommandRunner(
        clock,
        harnessChildEnvironment(),
        backend(checkout, evidence),
      );
      return Object.fromEntries(
        ["run", "runVouched"].map((method) => [
          method,
          async (...args) => {
            const observed = await commands[method](...args);
            await record(evidence, "verification-execution", { label, method, args, observed });
            return observed;
          },
        ]),
      );
    },
    taskOracle: { command: "node --test --test-reporter=tap solution.test.mjs" },
    immutablePaths: [
      "package.json",
      "solution.test.mjs",
      ...pathsInPatch(patch).filter((path) => path !== "solution.mjs"),
    ],
    clock,
    timeoutMs: 30000,
  });
  await record(evidence, "verification-verdict", { label, source, patch, checked });
  return checked;
}

export async function runArm(one, arm, runId, budget) {
  const evidence = await session(runId);
  const started = Date.now();
  let tokens = 0;
  let usageKnown = true;
  let source = "";
  let stopReason = "completed";
  let agentVerdict = null;
  const workspace = await workspaceFor(one, runId);
  const baseCommit = frozenBase(workspace);
  const model = modelClient(models.solver, evidence);
  const bounded = {
    modelId: model.modelId,
    recordsCancellation: true,
    generate: async (request) => {
      if (tokens >= budget.tokens) throw new Error("campaign token budget exhausted");
      const response = await model.generate({
        ...request,
        maxOutputTokens: Math.min(
          budget.modelOutputTokens,
          request.maxOutputTokens,
          budget.tokens - tokens,
        ),
      });
      tokens += response.inputTokens + response.outputTokens;
      usageKnown &&= response.usageStatus !== "unknown";
      return response;
    },
  };
  await record(evidence, "arm-launched", {
    caseId: one.id,
    arm,
    budget,
    model: models.solver,
    baseCommit,
  });
  try {
    if (arm === "swarm") {
      const task = await runAgentTask({
        task: `${one.specification}\nImplement solve in solution.mjs without imports, I/O, timers or dependencies. Change only solution.mjs. Read the existing files, declare the intended file set, and preserve the existing public tests.`,
        workspace,
        baseRef: baseCommit,
        maxSteps: 8,
        attempts: 1,
        maxTokens: budget.tokens,
        maxWallTimeMs: budget.wallMs,
        model: bounded,
        evidence,
        fileSet: createFileSetRegistry(evidence),
        clock,
        random: { next: () => 0.17 },
        emit: () => {},
        confirm: async () => false,
        abortSignal: AbortSignal.timeout(budget.wallMs),
        homeDir: homedir(),
        isolation: backend(workspace, evidence),
        sampling: { temperature: 0, topP: 1, seed: 17 },
      });
      source = await readCampaignSource(workspace);
      stopReason = task.loop.stopReason;
      agentVerdict = task.verdict;
    } else {
      const messages = [
        {
          role: "user",
          text: `${one.specification}\nPublic examples: ${JSON.stringify(one.publicChecks)}\nReturn JSON {"source":"complete ES module exporting solve"}. No imports or I/O. Existing source:\n${await readFile(join(workspace, "solution.mjs"), "utf8")}`,
        },
      ];
      for (let attempt = 0; attempt < (arm === "direct-feedback" ? 3 : 1); attempt++) {
        const remaining = budget.wallMs - (Date.now() - started);
        if (remaining <= 0) throw new Error("campaign wall budget exhausted");
        const response = await bounded.generate({
          system:
            "Implement the complete specification. Return only JSON containing the complete source file, without markdown.",
          messages,
          tools: [],
          maxOutputTokens: budget.modelOutputTokens,
          sampling: { temperature: 0, topP: 1, seed: 17 },
          abortSignal: AbortSignal.timeout(remaining),
        });
        source = parseModelJson(response.text, sourceResponseSchema).source;
        if (arm === "direct-once") break;
        const checked = await checkVectors(evidence, source, one.publicChecks, "baseline-feedback");
        if (checked.status === "passed") break;
        messages.push(
          { role: "assistant", text: response.text, toolCalls: [] },
          {
            role: "user",
            text: `Public examples failed: ${JSON.stringify(checked.matches)}. Correct the source. Only public feedback is available.`,
          },
        );
      }
    }
    const productionMs = Date.now() - started;
    const withinBudget = usageKnown && tokens <= budget.tokens && productionMs <= budget.wallMs;
    const publicCheck = await checkVectors(evidence, source, one.publicChecks, "public");
    const heldBack = await checkVectors(evidence, source, one.checks, "withheld");
    const verification = await verifySource(
      evidence,
      one,
      source,
      runId,
      arm === "swarm" ? { workspace, baseCommit } : undefined,
    );
    const outcome = {
      runId,
      caseId: one.id,
      arm,
      status: "completed",
      stopReason,
      tokens: usageKnown ? tokens : null,
      productionMs,
      totalMs: Date.now() - started,
      costUsd: null,
      source,
      withinBudget,
      acceptedWithinBudget: heldBack.status === "passed" && withinBudget,
      publicAccepted: publicCheck.status === "passed",
      heldBackAccepted: heldBack.status === "unavailable" ? null : heldBack.status === "passed",
      certified: verification.verified,
      agentVerdict,
      verification,
      cleanup: "confirmed",
    };
    await record(evidence, "arm-settled", outcome);
    return outcome;
  } catch (cause) {
    let cleanup = "unmeasured";
    try {
      const remaining = execFileSync(
        "docker",
        ["ps", "--all", "--quiet", "--filter", `label=dev.swarm.session=${runId}`],
        { encoding: "utf8", timeout: 10000, env: containerClientEnvironment() },
      ).trim();
      cleanup = remaining === "" ? "confirmed" : "failed";
      await record(evidence, "failure-cleanup-inspection", { remaining, cleanup });
    } catch {
      /* Runtime unavailability remains an unknown cleanup outcome. */
    }
    const outcome = {
      runId,
      caseId: one.id,
      arm,
      status: "failed",
      withinBudget: false,
      acceptedWithinBudget: false,
      stopReason: String(cause),
      tokens: usageKnown ? tokens : null,
      totalMs: Date.now() - started,
      costUsd: null,
      source,
      heldBackAccepted: null,
      certified: null,
      cleanup,
    };
    await record(evidence, "arm-settled", outcome);
    return outcome;
  } finally {
    await exportSession(evidence);
  }
}
