import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where sessions, baselines and sealed checks live: SWARM_HOME, or ~/.swarm. */
export function swarmHome(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.SWARM_HOME ?? join(homedir(), ".swarm");
}

const installable = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "uv.lock",
];

/**
 * Dependencies are installed fresh from the lockfile where the repository has one the verifier
 * installs from, so results are reproducible and upgrades are judged on their own lockfile.
 * Without one, the workspace's installed tree is linked, which the result reports as not
 * reproducible.
 */
export async function dependencyPolicy(workspace: string): Promise<"prepare" | "linked"> {
  const found = await Promise.all(
    installable.map((name) =>
      access(join(workspace, name)).then(
        () => true,
        () => false,
      ),
    ),
  );
  return found.some(Boolean) ? "prepare" : "linked";
}

/** The ledger as written so far: its digest and how many records it holds, for the signature. */
export async function ledgerPrefix(
  path: string,
): Promise<{ readonly ledgerSha256: string; readonly ledgerRecords: number }> {
  const text = await readFile(path, "utf8");
  const records = text.split("\n").filter((line) => line.length > 0).length;
  return { ledgerSha256: createHash("sha256").update(text).digest("hex"), ledgerRecords: records };
}
