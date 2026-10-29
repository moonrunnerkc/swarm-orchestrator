import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { DeclaredCheck } from "../config/swarm-toml.ts";
import { gitText } from "./change.ts";

const sealedSchema = z.object({
  glob: z.string().min(1),
  checks: z
    .array(z.object({ name: z.string(), command: z.string(), kind: z.enum(["test", "other"]) }))
    .min(1),
  files: z.array(z.object({ path: z.string().min(1), sha256: z.string() })).min(1),
});
export type SealedSet = z.infer<typeof sealedSchema>;

export class SealError extends Error {
  constructor(detail: string) {
    super(`nothing was sealed: ${detail}`);
    this.name = "SealError";
  }
}

/** Where sealed sets live: outside the workspace, under SWARM_HOME or ~/.swarm, owner-only. */
export function swarmHome(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.SWARM_HOME ?? join(homedir(), ".swarm");
}

export async function sealedDirectory(
  workspace: string,
  home: string = swarmHome(),
): Promise<string> {
  const top = await gitText(workspace, ["rev-parse", "--show-toplevel"]);
  const key = createHash("sha256")
    .update(await realpath(top))
    .digest("hex")
    .slice(0, 32);
  return join(home, "sealed", key);
}

/** `**` crosses directories, `*` and `?` stay inside one. */
export function globPattern(glob: string): RegExp {
  let pattern = "";
  for (let at = 0; at < glob.length; at += 1) {
    const character = glob[at] ?? "";
    if (glob.startsWith("**/", at)) {
      pattern += "(?:.*/)?";
      at += 2;
    } else if (glob.startsWith("**", at)) {
      pattern += ".*";
      at += 1;
    } else if (character === "*") pattern += "[^/]*";
    else if (character === "?") pattern += "[^/]";
    else pattern += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Moves the files matching the glob out of the workspace into the sealed store, with the test
 * checks that will run them. Nothing under the store is ever given to `swarm run`.
 */
export async function seal(
  workspace: string,
  glob: string,
  checks: readonly DeclaredCheck[],
  home: string = swarmHome(),
): Promise<{ readonly directory: string; readonly sealed: SealedSet }> {
  const tests = checks.filter((check) => check.kind === "test");
  if (tests.length === 0) throw new SealError("declare a test check in swarm.toml first");
  const listed = await gitText(workspace, ["ls-files", "-co", "--exclude-standard"]);
  const matcher = globPattern(glob);
  const paths = listed.split("\n").filter((path) => path.length > 0 && matcher.test(path));
  if (paths.length === 0) throw new SealError(`no file in the workspace matches ${glob}`);
  const directory = await sealedDirectory(workspace, home);
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, "files"), { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const files = [];
  for (const path of paths) {
    const content = await readFile(join(workspace, path));
    const target = join(directory, "files", path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { mode: 0o600 });
    files.push({ path, sha256: createHash("sha256").update(content).digest("hex") });
  }
  const sealed: SealedSet = { glob, checks: [...tests], files };
  await writeFile(join(directory, "sealed.json"), `${JSON.stringify(sealed, null, 2)}\n`, {
    mode: 0o600,
  });
  for (const path of paths) await rm(join(workspace, path), { force: true });
  return { directory, sealed };
}

export async function readSealed(
  workspace: string,
  home: string = swarmHome(),
): Promise<SealedSet | null> {
  const directory = await sealedDirectory(workspace, home);
  let text: string;
  try {
    text = await readFile(join(directory, "sealed.json"), "utf8");
  } catch {
    return null;
  }
  return sealedSchema.parse(JSON.parse(text));
}

/** Copies the sealed files into a checkout, refusing any whose bytes changed in the store. */
export async function overlaySealed(
  workspace: string,
  sealed: SealedSet,
  dir: string,
  home: string = swarmHome(),
): Promise<void> {
  const directory = await sealedDirectory(workspace, home);
  for (const file of sealed.files) {
    const content = await readFile(join(directory, "files", file.path));
    if (createHash("sha256").update(content).digest("hex") !== file.sha256) {
      throw new SealError(`the sealed copy of ${file.path} changed after it was sealed`);
    }
    await mkdir(dirname(join(dir, file.path)), { recursive: true });
    await writeFile(join(dir, file.path), content);
  }
}
