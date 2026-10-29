import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { DeclaredCheck } from "../config/swarm-toml.ts";
import { gitText } from "./change.ts";
import { type BaseCheckout, resetTracked, restoreFromBase } from "./checkout.ts";
import { baseCache, type CheckContext, type CheckRun, runCheck, runChecks } from "./checks.ts";
import { judgeSha256, prepareJudge, readJudge } from "./judge.ts";
import type { Baseline, Predicate } from "./predicate.ts";

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

export interface SealedRun {
  readonly runs: readonly CheckRun[];
  readonly processes: number;
  readonly assertionCalls: number;
  /** What the judge found, one line per check it failed. */
  readonly problems: readonly string[];
}

/**
 * Runs the sealed checks with the judge loaded into their Node and Python processes. A check
 * whose assertions the code under test changed fails, whatever its exit code says.
 */
export async function runSealed(
  sealed: SealedSet,
  context: CheckContext,
  scratch: string,
): Promise<SealedRun> {
  const runs: CheckRun[] = [];
  const problems: string[] = [];
  let processes = 0;
  let assertionCalls = 0;
  for (const check of sealed.checks) {
    const judge = await prepareJudge(scratch, check.name, context.dir);
    const run = await runCheck(check, context, judge.env);
    const reading = await readJudge(judge.report);
    processes += reading.processes;
    assertionCalls += reading.assertionCalls;
    if (reading.problem === null) {
      runs.push(run);
      continue;
    }
    problems.push(`held-out check ${check.name}: ${reading.problem}`);
    runs.push({ ...run, result: { ...run.result, result: "fail" } });
  }
  return { runs, processes, assertionCalls, problems };
}

/** A digest of the sealed set, so a base run is reused only for the same held-out checks. */
export function sealedSha256(sealed: SealedSet | null): string {
  return createHash("sha256").update(JSON.stringify(sealed)).digest("hex");
}

/**
 * Every declared and held-out check at the base commit, before the change applies, reused from
 * SWARM_HOME when the same base, environment, sealed set and judge were measured before. The
 * checkout is put back to the base as committed afterwards.
 */
export async function measureBase(input: {
  readonly checkout: BaseCheckout;
  readonly checks: readonly DeclaredCheck[];
  readonly sealed: SealedSet | null;
  readonly context: CheckContext;
  readonly home: string;
  readonly environment: Predicate["environment"];
  readonly workspace: string;
}): Promise<Baseline> {
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        input.checkout.baseCommit,
        input.environment.sha256,
        sealedSha256(input.sealed),
        judgeSha256,
      ]),
    )
    .digest("hex");
  const file = baseCache.file(input.home, key);
  const environmentSha256 = input.environment.sha256;
  const cached = await baseCache.read(file);
  if (cached !== null) return { status: "measured", cached: true, environmentSha256, ...cached };
  const checks = (await runChecks(input.checks, input.context)).map((run) => run.result);
  let heldOut: CheckRun["result"][] = [];
  if (input.sealed !== null) {
    await overlaySealed(input.workspace, input.sealed, input.checkout.dir, input.home);
    const scratch = dirname(input.checkout.dir);
    heldOut = (await runSealed(input.sealed, input.context, scratch)).runs.map((run) => run.result);
    await restoreFromBase(
      input.checkout,
      input.sealed.files.map((entry) => entry.path),
    );
  }
  await resetTracked(input.checkout);
  await baseCache.write(file, { checks, heldOut });
  return { status: "measured", cached: false, environmentSha256, checks, heldOut };
}
