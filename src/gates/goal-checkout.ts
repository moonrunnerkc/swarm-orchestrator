import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Preserve the verifier's setup, including installed dependencies, between candidate checks. */
export async function snapshotGoalCheckout(checkout: string, signal?: AbortSignal) {
  const snapshot = await mkdtemp(join(dirname(checkout), "swarm-goal-snapshot-"));
  const dispose = () => rm(snapshot, { recursive: true, force: true });
  const copy = async (from: string, to: string, cancellation?: AbortSignal) => {
    await cp(from, to, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: () => {
        cancellation?.throwIfAborted();
        return true;
      },
    });
  };
  try {
    signal?.throwIfAborted();
    await copy(checkout, snapshot, signal);
  } catch (cause) {
    await dispose();
    throw cause;
  }
  return {
    async restore() {
      const observed = await lstat(checkout);
      if (!observed.isDirectory() || observed.isSymbolicLink())
        throw new Error(
          "goal check replaced its checkout root; preserve the remaining verifier files",
        );
      for (const name of await readdir(checkout))
        await rm(join(checkout, name), { recursive: true, force: true });
      await copy(snapshot, checkout);
    },
    dispose,
  };
}

/** A candidate may contain links; harness-authored artifacts must never traverse them. */
export async function prepareGoalArtifact(checkout: string, relativePath: string): Promise<string> {
  let parent = checkout;
  const components = relativePath.split("/");
  for (const component of components.slice(0, -1)) {
    parent = join(parent, component);
    try {
      await mkdir(parent);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    }
    const observed = await lstat(parent);
    if (!observed.isDirectory() || observed.isSymbolicLink())
      throw new Error(`acceptance artifact parent is not an ordinary directory: ${relativePath}`);
  }
  return join(checkout, relativePath);
}

export async function goalArtifactUnchanged(
  checkout: string,
  relativePath: string,
  content: string,
): Promise<boolean> {
  let path = checkout;
  try {
    for (const component of relativePath.split("/")) {
      path = join(path, component);
      if ((await lstat(path)).isSymbolicLink()) return false;
    }
    return (await readFile(path, "utf8")) === content;
  } catch (cause) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes((cause as NodeJS.ErrnoException).code ?? ""))
      return false;
    throw cause;
  }
}
