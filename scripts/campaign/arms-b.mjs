/**
 * Comparison B: one complete workflow on one goal. The coding agent is the same in every arm:
 * the swarm worker loop at the pinned revision, the pinned local model, on this host in the
 * product's default restricted mode (the agent needs the registry to regenerate a lockfile, and
 * its dependencies are installed for this host by the goal's own argv), the same task text and
 * the same total budget. Arms differ only in what
 * checks the work and what happens when the check refuses:
 *
 * - b1-ci: the visible checks sit in the tree as committed acceptance material; after the agent,
 *   plain CI (project tests and visible checks) decides; a refusal is fed back as CI output.
 * - b2-sv-baseline: the worker's preset path under the pinned visible contract, challenges off.
 * - b3-sv-challenges: the same with `--challenges required`, strengthening off.
 * - b4-sv-repair: the same with `--challenges required --strengthen`.
 * - b5-vera: the b1 workspace, the agent recorded by `vera record`, `vera verify` deciding, a
 *   refusal fed back as VERA's output.
 *
 * b1 and b5 get at most two repair invocations, the cap the swarm arms' own loop works within,
 * all inside the one wall-clock and token budget. Truth is scored afterwards, apart from every
 * arm, by the sealed hidden oracle on the final tree.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { commitAcceptanceMaterial } from "./acceptance-material.mjs";
import {
  ciDecision,
  swarmResultLine,
  swarmTaskDecision,
  swarmTaskTokens,
  veraDecision,
} from "./decisions.mjs";
import { veraGoalYaml } from "./vera-goal.mjs";
import {
  applyPatch,
  campaignRoot,
  cloneAtBase,
  containerArgv,
  ensureImage,
  finalPatch,
  imageFor,
  prepareDependencies,
  prepareDependenciesOnHost,
  verifierInstalls,
} from "./workspace.mjs";

export const repairInvocations = 2;
/** The committed acceptance material of b1 and b5, left out of the change truth is scored on. */
export const acceptancePaths = [".campaign", "acceptance/visible"];
const veraTool = join(campaignRoot, "tools/vera");

/** The task text every arm's agent receives, identical across arms for one goal. */
export function taskPrompt(goal, contract) {
  const checks = contract.checks
    .map(
      (check) =>
        `- ${check.id}: ${check.behavior?.kind === "browser" ? "a browser check" : check.command}`,
    )
    .join("\n");
  return [
    goal.taskText.trim(),
    "",
    "Visible acceptance checks for this task (they must pass; they are not the only criterion):",
    checks,
    `The project's own tests run with: ${goal.projectTest.join(" ")}`,
  ].join("\n");
}

/** The contract as plain CI and VERA hold it in the tree: the checks, nothing reserved for the harness. */
export function treeContract(contract) {
  const { challenges: _reservedForTheHarness, ...rest } = contract;
  return rest;
}

function agentArgv(context, workspace, base, prompt, extra, remaining) {
  const { pins } = context;
  return [
    "node",
    pins.swarmCli,
    prompt,
    "--model",
    pins.model,
    "--local-endpoint",
    pins.endpoint,
    "--workspace",
    workspace,
    "--base",
    base,
    "--max-tokens",
    String(remaining.tokens),
    "--max-wall-minutes",
    String(Math.max(1, Math.floor(remaining.agentMs / 60_000))),
    // Unattended: allowlist prompts are answered by the harness and recorded, as in every arm.
    "--approve",
    "auto",
    "--no-tui",
    "--no-open-evidence",
    "--json",
    ...extra,
  ];
}

async function prepareWorkspace(context, withMaterial) {
  const { log, loaded, scratch } = context;
  const workspace = join(scratch, "workspace");
  await cloneAtBase(log, loaded.goal, workspace);
  const base = withMaterial
    ? await commitAcceptanceMaterial(log, workspace, treeContract(loaded.contract))
    : loaded.goal.upstreamBase;
  const installed = await prepareDependenciesOnHost(log, loaded.goal, workspace);
  if (!installed.ok) throw new Error(`install failed: ${installed.failed.join(" ")}`);
  // The model's settings, kept out of the change the arm is judged on.
  writeFileSync(
    join(workspace, "swarm.toml"),
    `[providers]\nlocal_endpoint = "${context.pins.endpoint}"\nlocal_thinking = false\n`,
  );
  appendFileSync(join(workspace, ".git/info/exclude"), "\nswarm.toml\n");
  return { workspace, base };
}

/** Spend one agent invocation, charging its wall time and tokens to the launch. */
async function invokeAgent(context, argv, cwd) {
  const ran = await context.log.run(argv, {
    cwd,
    timeoutMs: context.remaining.agentMs + 120_000,
    ...context.kill,
  });
  const stdout = ran.stdout.toString();
  const tokens = swarmTaskTokens(stdout);
  if (tokens === null) context.tokensUnknown = true;
  else context.tokensTotal += tokens;
  context.remaining.tokens = Math.max(1, context.remaining.tokens - (tokens ?? 0));
  context.remaining.agentMs -= ran.wallMs;
  const result = swarmResultLine(stdout);
  // The hidden oracle lives outside the workspace and the tool guard refuses outside paths, which
  // is a lexical guard, not a sandbox; so every run's own evidence is searched for the sealed
  // location, and a hit is recorded on the launch.
  const evidence = result?.bundleDirectory ? join(result.bundleDirectory, "..") : null;
  if (evidence !== null) {
    const hits = spawnSync("grep", ["-rlF", "swarm-campaign/sealed", evidence], {
      encoding: "utf8",
    });
    context.notes.push(
      hits.stdout.trim() === ""
        ? `oracle exposure scan: no mention of the sealed location in ${evidence}`
        : `ORACLE EXPOSURE: the sealed location appears in ${hits.stdout.trim().split("\n").length} evidence file(s) of ${evidence}`,
    );
  } else context.notes.push("oracle exposure scan: the run named no evidence directory");
  return { ran, stdout, result };
}

/**
 * Plain CI over the agent's change: a fresh checkout of the base with the acceptance material
 * committed, the change applied (acceptance edits included, as a repository's CI would run them),
 * the goal's install in its image, then the project tests and the visible checks with the network
 * off. The agent's own workspace is never the tree CI judges.
 */
async function ciCheck(context, workspace, base) {
  const { log, loaded } = context;
  const image = imageFor(loaded.goal, loaded.contract);
  const codes = [];
  const tails = [];
  const change = await finalPatch(log, workspace, base);
  const fresh = join(context.scratch, `ci-${Date.now()}`);
  await cloneAtBase(log, loaded.goal, fresh);
  await commitAcceptanceMaterial(log, fresh, treeContract(loaded.contract));
  if (!(await applyPatch(log, fresh, change, `ci-${Date.now()}`)))
    return {
      decision: "refuse",
      feedback: "the change does not apply to a fresh checkout",
      codes: [null],
    };
  const installed = await prepareDependencies(log, loaded.goal, fresh);
  if (!installed.ok)
    return {
      decision: "refuse",
      feedback: `the install failed: ${installed.failed.join(" ")}`,
      codes: [null],
    };
  for (const argv of [
    loaded.goal.projectTest,
    ["node", ".campaign/visible-runner.mjs", ".campaign/contract.json", "--from-tree"],
  ]) {
    const ran = await log.run(containerArgv({ image, directory: fresh, argv, network: false }), {
      cwd: fresh,
      timeoutMs: context.budget.verifierMs,
    });
    codes.push(ran.exitCode);
    if (ran.exitCode !== 0)
      tails.push(
        `$ ${argv.join(" ")} (exit ${ran.exitCode})\n${`${ran.stdout}${ran.stderr}`.split("\n").slice(-60).join("\n")}`,
      );
  }
  return { decision: ciDecision(codes), feedback: tails.join("\n\n"), codes };
}

async function b1(context) {
  const { workspace, base } = await prepareWorkspace(context, true);
  const prompt = taskPrompt(context.loaded.goal, context.loaded.contract);
  await invokeAgent(
    context,
    agentArgv(context, workspace, base, prompt, [], context.remaining),
    workspace,
  );
  let check = await ciCheck(context, workspace, base);
  for (let repair = 1; repair <= repairInvocations && check.decision !== "accept"; repair += 1) {
    if (context.remaining.agentMs < 60_000) break;
    const brief = `${prompt}\n\nTool output from the project's CI after your change (it failed):\n${check.feedback}\n\nThe change is already in this workspace. Revise it so CI passes and the task is met.`;
    await invokeAgent(
      context,
      agentArgv(context, workspace, base, brief, [], context.remaining),
      workspace,
    );
    check = await ciCheck(context, workspace, base);
  }
  return {
    decision: check.decision,
    basis: `plain CI exited ${check.codes.join(", ")}`,
    patch: await finalPatch(
      context.log,
      workspace,
      context.loaded.goal.upstreamBase,
      acceptancePaths,
    ),
  };
}

async function swarmArm(context, extra) {
  const { loaded } = context;
  const { workspace, base } = await prepareWorkspace(context, false);
  const prompt = taskPrompt(loaded.goal, loaded.contract);
  const preset = loaded.contract.preset?.kind;
  if (preset === undefined)
    throw new Error(
      "the worker's goal-contract path needs a preset; a feature goal is unsupported",
    );
  const flags = [
    "--preset",
    preset,
    "--goal-contract",
    context.contractPath,
    // The final independent verification checks a fresh checkout: the verifier installs it, or
    // stages the workspace environment the goal's install prepared (see verifierInstalls).
    ...(verifierInstalls(loaded.goal, loaded.contract) ? ["--install"] : []),
    ...loaded.goal.packages.flatMap((path) => ["--package", path]),
    ...extra,
  ];
  const { ran, result } = await invokeAgent(
    context,
    agentArgv(context, workspace, base, prompt, flags, context.remaining),
    workspace,
  );
  return {
    decision: swarmTaskDecision(ran.exitCode, result, ran.stderr.toString()),
    basis: `swarm exited ${ran.exitCode}; acceptable ${result?.verdict?.acceptable}; task ${result?.verdict?.task}`,
    patch: await finalPatch(context.log, workspace, base),
  };
}

async function b5(context) {
  const { log, loaded, scratch } = context;
  const { workspace, base } = await prepareWorkspace(context, true);
  const home = join(scratch, "vera-home");
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home };
  const vera = join(veraTool, "darwin/vera");
  await log.run([vera, "init"], { cwd: workspace, timeoutMs: 60_000, env });
  writeFileSync(join(workspace, ".vera/goal.yaml"), veraGoalYaml(loaded.goal, loaded.contract));
  // VERA keeps its state and its evidence database in the working directory (the path is fixed in
  // its source); a user ignores both, and they are no part of the change the arm is judged on.
  appendFileSync(join(workspace, ".git/info/exclude"), ".vera/\nvera-evidence.db\n");
  const prompt = taskPrompt(loaded.goal, loaded.contract);
  const verify = async () => {
    // VERA's workflow as documented: record and verify on the host, over the agent's own
    // workspace, whose dependencies are this host's.
    const ran = await log.run([vera, "verify"], {
      cwd: workspace,
      env,
      timeoutMs: context.budget.verifierMs,
    });
    const stdout = `${ran.stdout}${ran.stderr}`;
    return {
      decision: veraDecision(ran.exitCode, ran.stdout.toString()),
      stdout,
      exitCode: ran.exitCode,
    };
  };
  const recorded = (brief) => [
    vera,
    "record",
    // Everything after `--` is the recorded agent's own argv, not VERA's flags.
    "--",
    // VERA's key directory is the launch's HOME; the agent keeps the machine's own, as it has in
    // every other arm, so its sessions and caches are where they always are.
    "env",
    `HOME=${homedir()}`,
    ...agentArgv(context, workspace, base, brief, [], context.remaining),
  ];
  await invokeAgent(context, recorded(prompt), workspace);
  let check = await verify();
  for (let repair = 1; repair <= repairInvocations && check.decision !== "accept"; repair += 1) {
    if (context.remaining.agentMs < 60_000) break;
    const brief = `${prompt}\n\nTool output from VERA's verification after your change (it did not pass):\n${check.stdout.split("\n").slice(-60).join("\n")}\n\nThe change is already in this workspace. Revise it so verification passes and the task is met.`;
    await invokeAgent(context, recorded(brief), workspace);
    check = await verify();
  }
  return {
    decision: check.decision,
    basis: `vera verify exited ${check.exitCode}`,
    patch: await finalPatch(context.log, workspace, loaded.goal.upstreamBase, acceptancePaths),
  };
}

const arms = {
  "b1-ci": b1,
  "b2-sv-baseline": (context) => swarmArm(context, []),
  "b3-sv-challenges": (context) => swarmArm(context, ["--challenges", "required"]),
  "b4-sv-repair": (context) => swarmArm(context, ["--challenges", "required", "--strengthen"]),
  "b5-vera": b5,
};

export const supportedBArms = Object.keys(arms);

/** Whether an arm natively supports a goal on the pinned revision, with the reason when not. */
export function bSupport(arm, contract) {
  if (arm.startsWith("b2") || arm.startsWith("b3") || arm.startsWith("b4"))
    if (contract.preset === undefined)
      return "the pinned worker path accepts a goal contract only with a bugfix, refactor or upgrade preset";
  return null;
}

export async function runComparisonB(context, launch) {
  await ensureImage(context.log, context.loaded.goal);
  return arms[launch.arm](context);
}
