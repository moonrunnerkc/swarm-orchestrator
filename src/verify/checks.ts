import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { DeclaredCheck } from "../config/swarm-toml.ts";
import { childEnvironment } from "../exec/child-environment.ts";
import { runProcessGroup } from "../exec/run-process.ts";
import { gitText } from "./change.ts";
import { type CheckResult, checkResultSchema, type Predicate } from "./predicate.ts";

export interface CheckRun {
  readonly result: CheckResult;
  /** The end of what the check printed, for the person or agent reading a failure. */
  readonly outputTail: string;
}

export interface CheckContext {
  readonly dir: string;
  /** A private HOME for the checks; never the operator's. */
  readonly home: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

const maxOutputBytes = 4 * 1024 * 1024;
const tailBytes = 4000;

/** Runs one check through the shell in the checkout, under an environment built here. */
export async function runCheck(
  check: DeclaredCheck,
  context: CheckContext,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<CheckRun> {
  const { variables } = childEnvironment(process.env, { homeDir: context.home });
  const started = Date.now();
  const ran = await runProcessGroup("/bin/sh", ["-c", check.command], {
    cwd: context.dir,
    env: { ...variables, ...extraEnv },
    timeoutMs: context.timeoutMs,
    maxOutputBytes,
    signal: context.signal,
  });
  const output = `${ran.stdout}${ran.stderr}`;
  const failedToRun = ran.startFailure !== null || ran.timedOut || ran.cancelled;
  const note = ran.timedOut
    ? "\n[timed out]"
    : ran.startFailure === null
      ? ""
      : `\n[${ran.startFailure}]`;
  return {
    result: {
      name: check.name,
      command: check.command,
      kind: check.kind,
      result: failedToRun ? "error" : ran.exitCode === 0 ? "pass" : "fail",
      exitCode: failedToRun ? null : ran.exitCode,
      durationMs: Date.now() - started,
      outputSha256: createHash("sha256").update(output).digest("hex"),
    },
    outputTail: `${output.slice(-tailBytes)}${note}`,
  };
}

export async function runChecks(
  checks: readonly DeclaredCheck[],
  context: CheckContext,
  envFor: (check: DeclaredCheck) => Readonly<Record<string, string>> = () => ({}),
): Promise<readonly CheckRun[]> {
  const runs: CheckRun[] = [];
  for (const check of checks) runs.push(await runCheck(check, context, envFor(check)));
  return runs;
}

const linkable = ["node_modules", ".venv"];

/**
 * Gives the clean checkout the workspace's installed dependencies. A setup command from the
 * base's swarm.toml runs instead where there is one. Linking is sound because a change that
 * also touches a lockfile is refused unless swarm.toml allows it.
 */
export async function prepareDependencies(
  workspace: string,
  setup: string | null,
  context: CheckContext,
): Promise<{ readonly mode: "linked" | "setup" | "none"; readonly failure: CheckRun | null }> {
  if (setup !== null) {
    const ran = await runCheck({ name: "setup", command: setup, kind: "other" }, context);
    return { mode: "setup", failure: ran.result.result === "pass" ? null : ran };
  }
  let linked = false;
  for (const name of linkable) {
    const source = join(workspace, name);
    const isDirectory = await lstat(source).then(
      (stats) => stats.isDirectory(),
      () => false,
    );
    const taken = await lstat(join(context.dir, name)).then(
      () => true,
      () => false,
    );
    if (!isDirectory || taken) continue;
    await symlink(source, join(context.dir, name), "dir");
    linked = true;
  }
  return { mode: linked ? "linked" : "none", failure: null };
}

export async function privateHome(scratch: string): Promise<string> {
  const home = join(scratch, "home");
  await mkdir(home, { recursive: true, mode: 0o700 });
  return home;
}

/** The share of measured checks that passed; a pre-existing failure is not measured. */
export function passRate(runs: readonly CheckResult[]): number {
  const measured = runs.filter((run) => run.result !== "pre-existing-failure");
  return measured.length === 0
    ? 0
    : measured.filter((run) => run.result === "pass").length / measured.length;
}

const lockfiles = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "uv.lock",
  "poetry.lock",
];

/**
 * What the checks ran on, and one digest over it: toolchain, platform, the check commands and
 * the lockfiles in the checkout. Two runs with the same digest ran the same declared commands
 * against the same pinned dependencies on the same toolchain.
 */
export async function environmentOf(
  dir: string,
  checks: readonly DeclaredCheck[],
  dependencies: Predicate["environment"]["dependencies"],
): Promise<Predicate["environment"]> {
  const git = (await gitText(dir, ["--version"])).replace(/^git version /, "");
  const locks: Record<string, string> = {};
  for (const name of lockfiles) {
    const content = await readFile(join(dir, name)).catch(() => null);
    if (content !== null) locks[name] = createHash("sha256").update(content).digest("hex");
  }
  const described = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    git,
    dependencies,
    checks: checks.map(({ name, command }) => ({ name, command })),
    lockfiles: locks,
  };
  return {
    sha256: createHash("sha256").update(JSON.stringify(described)).digest("hex"),
    node: described.node,
    platform: described.platform,
    git,
    dependencies,
  };
}

const storedBaseSchema = z.object({
  checks: z.array(checkResultSchema),
  heldOut: z.array(checkResultSchema),
});
export type StoredBase = z.infer<typeof storedBaseSchema>;

/**
 * Base results kept under SWARM_HOME, owner-only, one file per key. A file that does not parse
 * is ignored and the base is run again; nothing here is trusted past its schema.
 */
export const baseCache = {
  file: (home: string, key: string) => join(home, "baselines", `${key}.json`),
  async read(file: string): Promise<StoredBase | null> {
    const text = await readFile(file, "utf8").catch(() => null);
    if (text === null) return null;
    try {
      return storedBaseSchema.parse(JSON.parse(text));
    } catch {
      return null;
    }
  },
  async write(file: string, value: StoredBase): Promise<void> {
    await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  },
};

/**
 * A check judged against its base run: one that failed at base and still fails measures
 * nothing about the change; one that failed at base and passes now was fixed by it.
 */
export function againstBase(run: CheckRun, base: CheckResult | undefined): CheckRun {
  if (base === undefined || base.result === "pass" || run.result.result === "pass") return run;
  return {
    ...run,
    result: { ...run.result, result: "pre-existing-failure", baseOutputSha256: base.outputSha256 },
  };
}
