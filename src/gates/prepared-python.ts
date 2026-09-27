import { appendFile, cp, lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { asJsonValue, digestOfBytes, digestOfJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

/** Copy a prepared project environment without installing or changing the user's environment. */
export async function stagePreparedPython(options: {
  repository: string;
  checkout: string;
  packages?: readonly string[];
  evidence?: EvidenceRecorder;
}): Promise<void> {
  for (const unit of [".", ...(options.packages ?? [])]) {
    if (
      !(await lstat(join(options.checkout, unit, "pyproject.toml")).then(
        (stat) => stat.isFile(),
        () => false,
      ))
    )
      continue;
    const source = join(options.repository, unit, ".venv");
    const destination = join(options.checkout, unit, ".venv");
    const config = await readFile(join(source, "pyvenv.cfg"), "utf8").catch(
      (cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return null;
        throw cause;
      },
    );
    if (config === null) continue;
    if (!(await lstat(source)).isDirectory() || (await lstat(source)).isSymbolicLink())
      throw new Error(`prepared Python environment ${unit}/.venv must be an ordinary directory`);
    if (
      await lstat(destination).then(
        () => true,
        () => false,
      )
    )
      throw new Error(
        `candidate already supplies ${unit}/.venv; do not track a mutable environment`,
      );
    let bytes = 0;
    const inventory: { path: string; digest: string }[] = [];
    const inspect = async (directory: string, relative: string, depth: number): Promise<void> => {
      if (depth > 32 || inventory.length > 50000)
        throw new Error("prepared Python environment exceeds file bound");
      for (const name of await readdir(directory)) {
        const file = join(directory, name);
        const path = relative ? `${relative}/${name}` : name;
        const stat = await lstat(file);
        if (stat.isDirectory()) {
          await inspect(file, path, depth + 1);
          continue;
        }
        if (stat.isSymbolicLink()) {
          if (!/^bin\/python(?:[0-9.]+)?$/.test(path))
            throw new Error(`unsupported link in prepared Python environment: ${path}`);
          inventory.push({ path, digest: digestOfBytes(await readlink(file)) });
          continue;
        }
        if (!stat.isFile()) throw new Error(`unsupported prepared environment entry: ${path}`);
        bytes += stat.size;
        if (bytes > 512_000_000 || stat.size > 64_000_000)
          throw new Error("prepared Python environment exceeds 512 MB copy bound");
        const content = await readFile(file);
        if (
          name.endsWith(".pth") &&
          content
            .toString("utf8")
            .split(/\r?\n/)
            .some(
              (line) =>
                line.trim() && !line.startsWith("#") && line.trim() !== "import _virtualenv",
            )
        )
          throw new Error(
            `editable or executable Python path injection ${path} cannot identify a clean candidate; use a prepared isolated runtime`,
          );
        inventory.push({ path, digest: digestOfBytes(content) });
      }
    };
    await inspect(source, "", 0);
    const identity = {
      rule: "prepared-python-v1",
      unit,
      bytes,
      files: inventory.length,
      environmentDigest: digestOfJson(inventory),
      configurationDigest: digestOfBytes(config),
    };
    await options.evidence?.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["file"],
      payload: asJsonValue({ ...identity, phase: "intent" }),
    });
    await cp(source, destination, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
    });
    inventory.length = 0;
    bytes = 0;
    await inspect(destination, "", 0);
    if (digestOfJson(inventory) !== identity.environmentDigest)
      throw new Error(
        "prepared Python environment changed during staging; reconcile the owned copy",
      );
    await appendFile(
      join(options.checkout, ".git/info/exclude"),
      `\n/${unit === "." ? "" : `${unit}/`}.venv/\n`,
    );
    await options.evidence?.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({ ...identity, phase: "completed" }),
    });
  }
}
