import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

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
      await restoreDirectory(snapshot, checkout);
    },
    dispose,
  };
}

/** Keep directory identities stable for mounted filesystems while removing candidate additions. */
async function restoreDirectory(source: string, destination: string): Promise<void> {
  const names = await readdir(source);
  const expected = new Set(names);
  for (const name of await readdir(destination))
    if (!expected.has(name)) await rm(join(destination, name), { recursive: true, force: true });
  for (const name of names) {
    const from = join(source, name);
    const to = join(destination, name);
    const original = await lstat(from);
    const current = await lstat(to).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return null;
      throw cause;
    });
    if (original.isDirectory() && current?.isDirectory() && !current.isSymbolicLink()) {
      await chmod(to, original.mode);
      await restoreDirectory(from, to);
    } else if (original.isFile() && current?.isFile()) {
      await chmod(to, original.mode | 0o200);
      await pipeline(createReadStream(from), createWriteStream(to, { flags: "w" }));
      await chmod(to, original.mode);
    } else if (
      original.isSymbolicLink() &&
      current?.isSymbolicLink() &&
      (await readlink(from)) === (await readlink(to))
    ) {
    } else {
      if (current !== null) await rm(to, { recursive: true, force: true });
      await cp(from, to, { recursive: true, dereference: false, verbatimSymlinks: true });
    }
  }
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
