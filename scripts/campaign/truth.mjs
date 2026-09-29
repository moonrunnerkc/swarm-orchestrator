/**
 * Scoring a tree against a goal's sealed hidden oracle, outside every arm's reach: a fresh
 * checkout of the base, the candidate patch, the goal's own install, then the oracle's files
 * copied in and its argv run with the network off. The oracle's bytes are read from the sealed
 * directory at scoring time only and never enter an arm's workspace.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sealedDigest } from "./goal-package.mjs";
import {
  applyPatch,
  campaignRoot,
  cloneAtBase,
  containerArgv,
  imageFor,
  images,
  prepareDependencies,
} from "./workspace.mjs";

export const sealedRoot = join(campaignRoot, "sealed");

const runtimeEnvironment = {
  browser: { PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" },
  node: {},
  python: {},
};

/**
 * `pass` when the oracle exits 0, `fail` when it exits otherwise or passes its deadline, and
 * `unjudgeable` with the reason when the patch does not apply or the environment cannot be made.
 */
export async function scoreHidden(log, goal, patch, { keep = false } = {}) {
  const sealed = sealedDigest(join(sealedRoot, goal.id));
  if (sealed.digest !== goal.hidden.digest)
    return {
      hidden: "unjudgeable",
      basis: "the sealed oracle no longer matches its frozen digest",
    };
  const scratch = mkdtempSync(join(campaignRoot, "work", `truth-${goal.id}-`));
  const checkout = join(scratch, "checkout");
  try {
    await cloneAtBase(log, goal, checkout);
    if (!(await applyPatch(log, checkout, patch, "candidate")))
      return { hidden: "unjudgeable", basis: "the patch does not apply to the base" };
    const prepared = await prepareDependencies(log, goal, checkout);
    if (!prepared.ok)
      return { hidden: "unjudgeable", basis: `install failed: ${prepared.failed.join(" ")}` };
    return await judgeHiddenIn(log, goal, checkout, sealed);
  } finally {
    if (!keep) rmSync(scratch, { recursive: true, force: true });
  }
}

/** Run the sealed oracle over a prepared checkout, which it writes into; use a copy you can lose. */
export async function judgeHiddenIn(
  log,
  goal,
  checkout,
  sealed = sealedDigest(join(sealedRoot, goal.id)),
) {
  if (sealed.digest !== goal.hidden.digest)
    return {
      hidden: "unjudgeable",
      basis: "the sealed oracle no longer matches its frozen digest",
    };
  for (const file of sealed.declaration.files) {
    mkdirSync(join(checkout, file.to, ".."), { recursive: true });
    cpSync(join(sealedRoot, goal.id, file.from), join(checkout, file.to));
  }
  const image = sealed.declaration.runtime === "browser" ? images.browser : imageFor(goal);
  const env = runtimeEnvironment[sealed.declaration.runtime];
  for (const argv of sealed.declaration.setup) {
    const ran = await log.run(
      containerArgv({ image, directory: checkout, argv, network: false, env }),
      { cwd: checkout, timeoutMs: sealed.declaration.timeoutMs },
    );
    if (ran.exitCode !== 0)
      return { hidden: "fail", basis: `oracle setup ${argv.join(" ")} exited ${ran.exitCode}` };
  }
  const judged = await log.run(
    containerArgv({
      image,
      directory: checkout,
      argv: sealed.declaration.argv,
      network: false,
      env,
    }),
    { cwd: checkout, timeoutMs: sealed.declaration.timeoutMs },
  );
  return judged.exitCode === 0
    ? { hidden: "pass", basis: "the hidden oracle exited 0" }
    : {
        hidden: "fail",
        basis:
          judged.exitCode === null
            ? `the hidden oracle did not finish (${judged.signal})`
            : `the hidden oracle exited ${judged.exitCode}`,
      };
}
