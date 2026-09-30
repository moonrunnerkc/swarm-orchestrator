/**
 * Comparison A: one verifier arm's decision on one fixed condition patch. Every arm gets the same
 * base, the same patch bytes (their digest is recorded), the same visible requirement in the form
 * its native interface takes, and the same prepared dependencies; none receives the hidden oracle
 * and none may repair the candidate's source.
 *
 * Procedures: `single` runs the arm once. `stale-replay` first has the arm accept the condition it
 * replays, then puts the incorrect patch in place outside the arm and asks again the cheapest way
 * the arm natively allows. `interrupt-resume` kills the arm's first attempt at a fixed point and
 * runs it again over whatever state the kill left; the second answer is the decision.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAcceptanceMaterial, writeAcceptanceMaterial } from "./acceptance-material.mjs";
import { ciDecision, lastJsonLine, swarmCiDecision, veraDecision } from "./decisions.mjs";
import { veraGoalYaml } from "./vera-goal.mjs";
import {
  applyPatch,
  campaignRoot,
  cloneAtBase,
  containerArgv,
  ensureImage,
  imageFor,
  prepareDependencies,
  verifierInstalls,
} from "./workspace.mjs";

/** The kill point for interrupt-resume, fixed for every arm. */
export const interruptAfterMs = 20_000;

const veraTool = join(campaignRoot, "tools/vera");

async function ciArm(context, patch) {
  const { log, loaded, scratch } = context;
  const { goal, contract } = loaded;
  const checkout = join(scratch, `ci-${Date.now()}`);
  await cloneAtBase(log, goal, checkout);
  if (!(await applyPatch(log, checkout, patch, "candidate-ci")))
    return { decision: "refuse", basis: "the patch does not apply, so CI fails at checkout" };
  const install = await prepareDependencies(log, goal, checkout);
  if (!install.ok) return { decision: "refuse", basis: "the install step failed" };
  writeAcceptanceMaterial(checkout, contract);
  const image = imageFor(goal, contract);
  const steps = [
    goal.projectTest,
    ["node", ".campaign/visible-runner.mjs", ".campaign/contract.json"],
  ];
  const codes = [];
  for (const argv of steps) {
    const ran = await log.run(containerArgv({ image, directory: checkout, argv, network: false }), {
      cwd: checkout,
      timeoutMs: context.budget.verifierMs,
      ...context.kill,
    });
    codes.push(ran.exitCode);
  }
  return {
    decision: ciDecision(codes),
    basis: `project test and visible checks exited ${codes.join(", ")}`,
  };
}

async function veraPrepared(context, directory) {
  const { log, loaded } = context;
  await cloneAtBase(log, loaded.goal, directory);
  await commitAcceptanceMaterial(log, directory, loaded.contract);
  return true;
}

/**
 * The goal's install over the tree VERA is about to verify, after the change is in place, as the
 * plain CI arm installs after applying the patch: an upgrade's new lockfile is what gets installed.
 */
async function veraInstall(context, directory) {
  const installed = await prepareDependencies(context.log, context.loaded.goal, directory);
  if (!installed.ok)
    context.notes.push(`install over the verified tree failed: ${installed.failed.join(" ")}`);
}

/**
 * One VERA command. `init` and `record` run on this host with the release's macOS build, as
 * VERA's own documentation runs them: the Linux `verabox` in the release needs glibc 2.39, which
 * the goal images do not have, and recording a `git apply` needs no project dependencies.
 * `verify` runs the contracts, so it runs inside the goal's image beside the dependencies every
 * other arm uses, with the release's Linux build. Both read the same `.vera` state and the same
 * key directory (VERA keeps its HMAC key under HOME), which is the launch's own.
 */
function veraStep(context, directory, argv, home) {
  const { log, loaded } = context;
  if (argv[0] !== "verify")
    return log.run([join(veraTool, "darwin/vera"), ...argv], {
      cwd: directory,
      env: { ...process.env, HOME: home },
      timeoutMs: context.budget.verifierMs,
      ...context.kill,
    });
  return log.run(
    containerArgv({
      image: imageFor(loaded.goal, loaded.contract),
      directory,
      argv: ["/opt/vera/vera", ...argv],
      network: false,
      env: { HOME: "/vera-home" },
      extraMounts: [`${veraTool}/linux:/opt/vera:ro`, `${home}:/vera-home`],
    }),
    { cwd: directory, timeoutMs: context.budget.verifierMs, ...context.kill },
  );
}

async function veraArm(context, patch, { replay = null } = {}) {
  const { scratch, loaded } = context;
  const checkout = join(scratch, `vera-${Date.now()}`);
  if (!(await veraPrepared(context, checkout)))
    return { decision: "inconclusive", basis: "the install step failed before VERA ran" };
  const home = join(scratch, `vera-home-${Date.now()}`);
  mkdirSync(home, { recursive: true });
  await veraStep(context, checkout, ["init"], home);
  writeFileSync(join(checkout, ".vera/goal.yaml"), veraGoalYaml(loaded.goal, loaded.contract));
  const submit = async (name, bytes) => {
    const path = join(scratch, `${name}.patch`);
    writeFileSync(path, bytes.endsWith("\n") ? bytes : `${bytes}\n`);
    return veraStep(context, checkout, ["record", "git", "apply", path], home);
  };
  if (replay !== null) {
    await submit("replayed", replay);
    await veraInstall(context, checkout);
    const first = await veraStep(context, checkout, ["verify"], home);
    context.notes.push(
      `replayed condition read ${veraDecision(first.exitCode, first.stdout.toString())}`,
    );
    // The incorrect patch reaches the tree outside VERA's recording; VERA is asked again.
    await context.log.run(["git", "checkout", "--quiet", "--", "."], {
      cwd: checkout,
      timeoutMs: 60_000,
    });
    await applyPatch(context.log, checkout, patch, "stale");
    await veraInstall(context, checkout);
  } else {
    await submit("candidate", patch);
    await veraInstall(context, checkout);
  }
  const verified = await veraStep(context, checkout, ["verify"], home);
  const stdout = verified.stdout.toString();
  return {
    decision: veraDecision(verified.exitCode, stdout),
    basis: `vera verify exited ${verified.exitCode}: ${stdout.trim().split("\n").slice(-3).join(" | ").slice(0, 400)}`,
  };
}

async function swarmVerifyArm(context, patch, challenges) {
  const { log, loaded, scratch, pins } = context;
  const { goal } = loaded;
  const checkout = join(scratch, `sv-${Date.now()}`);
  await cloneAtBase(log, goal, checkout);
  if (!verifierInstalls(goal, loaded.contract)) {
    const prepared = await prepareDependencies(log, goal, checkout);
    if (!prepared.ok) return { decision: "inconclusive", basis: "the install step failed" };
  }
  const patchPath = join(scratch, `sv-${Date.now()}.patch`);
  writeFileSync(patchPath, patch.endsWith("\n") ? patch : `${patch}\n`);
  const image = imageFor(goal, loaded.contract);
  const argv = [
    "node",
    pins.swarmCli,
    "ci",
    "--patch",
    patchPath,
    "--workspace",
    checkout,
    "--base",
    goal.upstreamBase,
    "--goal-contract",
    context.contractPath,
    ...(verifierInstalls(goal, loaded.contract) ? ["--install"] : []),
    "--isolation",
    `docker:${image}`,
    "--require-isolation",
    "--json",
    ...goal.packages.flatMap((path) => ["--package", path]),
    ...(challenges ? ["--challenges", "required"] : []),
  ];
  const ran = await log.run(argv, {
    cwd: scratch,
    timeoutMs: context.budget.verifierMs,
    ...context.kill,
  });
  const report = lastJsonLine(ran.stdout.toString());
  return {
    decision: swarmCiDecision(report, ran.stderr.toString()),
    basis: `ci exited ${ran.exitCode}: regression ${report?.regression}, task ${report?.task}, verified ${report?.verified}${report?.refusal ? `, refusal ${String(report.refusal).slice(0, 200)}` : ""}`,
  };
}

const arms = {
  "a-ci": (context, patch) => ciArm(context, patch),
  "a-vera": (context, patch, options) => veraArm(context, patch, options),
  "a-sv-s0": (context, patch) => swarmVerifyArm(context, patch, false),
  "a-sv-s1": (context, patch) => swarmVerifyArm(context, patch, true),
};

export const supportedAArms = Object.keys(arms);

/** Run one Comparison A launch; returns the decision and its basis. */
export async function runComparisonA(context, launch) {
  const { loaded } = context;
  const run = arms[launch.arm];
  if (run === undefined) throw new Error(`arm ${launch.arm} has no native runner on this host`);
  const condition = loaded.goal.conditions.find((one) => one.id === launch.condition);
  const patch = loaded.patches.get(condition.id);
  await ensureImage(context.log, loaded.goal);
  context.notes.push(`procedure ${condition.procedure}`);
  if (condition.procedure === "stale-replay") {
    const replay = loaded.patches.get(condition.replayOf);
    if (launch.arm === "a-vera") return run(context, patch, { replay });
    // CI and swarm-verify keep no acceptance between runs: the replayed acceptance is run and
    // recorded, and the question is asked again from scratch, which is all they natively offer.
    const first = await run(context, replay);
    context.notes.push(`replayed condition read ${first.decision}`);
    return run(context, patch);
  }
  if (condition.procedure === "interrupt-resume") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), interruptAfterMs);
    const cut = await run({ ...context, kill: { signal: controller.signal } }, patch).catch(
      (error) => ({ decision: "inconclusive", basis: `cut: ${error.message}` }),
    );
    clearTimeout(timer);
    context.notes.push(`interrupted attempt read ${cut.decision} (${cut.basis.slice(0, 160)})`);
    return run(context, patch);
  }
  return run(context, patch);
}
