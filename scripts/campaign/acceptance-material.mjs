/**
 * The visible acceptance material as an ordinary repository keeps it: the contract's artifact
 * files, the contract itself and the runner that executes its checks, committed on top of the
 * base in one local commit. Plain CI and VERA judge a tree that carries its own checks, so this is
 * how they receive the same visible requirement swarm-verify reads from its pinned contract.
 */
import { chmodSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const runner = join(dirname(fileURLToPath(import.meta.url)), "visible-runner.mjs");

/** Write the material into the tree without committing it (the plain CI arm's fresh run). */
export function writeAcceptanceMaterial(directory, contract) {
  mkdirSync(join(directory, ".campaign"), { recursive: true });
  cpSync(runner, join(directory, ".campaign/visible-runner.mjs"));
  writeFileSync(
    join(directory, ".campaign/contract.json"),
    `${JSON.stringify(contract, null, 2)}\n`,
  );
  for (const check of contract.checks)
    for (const artifact of check.artifacts) {
      const path = join(directory, artifact.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, artifact.content);
      chmodSync(path, 0o644);
    }
}

/** Commit the material on top of the base; returns the new commit id the arm diffs against. */
export async function commitAcceptanceMaterial(log, directory, contract) {
  writeAcceptanceMaterial(directory, contract);
  const git = (...args) =>
    log.run(["git", "-c", "user.name=campaign", "-c", "user.email=campaign@localhost", ...args], {
      cwd: directory,
      timeoutMs: 120_000,
    });
  await git("add", "--force", ".campaign", "acceptance/visible");
  const committed = await git(
    "commit",
    "--quiet",
    "--no-verify",
    "-m",
    "campaign: visible acceptance material",
  );
  if (committed.exitCode !== 0) throw new Error("the acceptance material could not be committed");
  const head = await git("rev-parse", "HEAD");
  return head.stdout.toString().trim();
}
