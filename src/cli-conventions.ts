import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { conventionSetSchema, conventionSources, type SourceText } from "swarm-verify";
import { gitText } from "./agent/git.ts";
import { swarmHome } from "./agent/verification.ts";
import { UsageError } from "./cli-command-definitions.ts";
import type { Handler } from "./cli-main.ts";
import { conventionLines, proposalProfile, proposeConventions } from "./conventions/learn.ts";
import {
  type ConventionProfile,
  effectiveConventions,
  profilePath,
  profileVersion,
  readProfile,
  writeProfile,
} from "./conventions/profile.ts";

const write = (text: string) => process.stdout.write(`${text}\n`);
const sampleCap = 60;
const empty = (): ConventionProfile => ({
  version: profileVersion,
  rules: {},
  guidance: [],
  sources: [],
});

/** The repository a workspace is in, or the directory itself where it is in none. */
const repositoryOf = (workspace: string) =>
  gitText(workspace, ["rev-parse", "--show-toplevel"]).catch(() => workspace);

/** The sources under each path given, or the repository's own tracked sources where none is. */
async function samples(repository: string, paths: readonly string[]): Promise<SourceText[]> {
  const files: string[] = [];
  for (const path of paths.map((one) => resolve(one))) {
    if (!(await stat(path)).isDirectory()) files.push(path);
    else
      for (const entry of await readdir(path, { recursive: true, withFileTypes: true }))
        if (entry.isFile() && !entry.parentPath.includes("node_modules"))
          files.push(join(entry.parentPath, entry.name));
  }
  if (paths.length === 0) {
    const tracked = (await gitText(repository, ["ls-files"])).split("\n");
    files.push(...tracked.map((path) => join(repository, path)));
  }
  const sources = files.filter((path) => conventionSources.test(path));
  // Spread over the whole list, so a large repository is sampled from every part of it.
  const step = Math.max(1, Math.ceil(sources.length / sampleCap));
  const read: SourceText[] = [];
  for (const path of sources.filter((_, at) => at % step === 0)) {
    const inside = relative(repository, path);
    read.push({
      path: inside.startsWith("..") ? path : inside,
      text: await readFile(path, "utf8"),
    });
  }
  return read;
}

function show(title: string, profile: Parameters<typeof conventionLines>[0] | null): void {
  write(title);
  const lines = profile === null ? [] : conventionLines(profile);
  for (const line of lines.length === 0 ? ["  nothing approved"] : lines) write(`  ${line}`);
}

/**
 * `init --learn`, `--approve`, `--set` and `--forget`: the conventions profile. Learning only
 * proposes, into a file under SWARM_HOME; a rule takes effect when the developer approves that
 * file or sets it by hand here, and at no other time. Anything else is the verifier's own init.
 */
export async function initCommand(args: readonly string[], verifierInit: Handler): Promise<number> {
  const ours = ["--learn", "--approve", "--set", "--forget"];
  if (!args.some((one) => ours.some((flag) => one === flag || one.startsWith(`${flag}=`))))
    return verifierInit(args);
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      learn: { type: "boolean" },
      approve: { type: "string" },
      set: { type: "string", multiple: true },
      forget: { type: "string", multiple: true },
      global: { type: "boolean" },
    },
  });
  const home = swarmHome();
  const repository = await repositoryOf(resolve(values.workspace ?? process.cwd()));
  if (values.learn === true) {
    const read = await samples(repository, positionals);
    if (read.length === 0)
      throw new UsageError("--learn found no JavaScript or TypeScript file in what it was given");
    const proposal = await proposeConventions(read, repository);
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
    const file = join(home, "conventions", "proposals", `${stamp}.toml`);
    await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
    await writeFile(file, proposal, { mode: 0o600 });
    write(proposal);
    write(`proposal     ${file}`);
    write(`Nothing is in effect yet. Read and edit it, then: swarm init --approve ${file}`);
    return 0;
  }
  const path = profilePath(home, values.global === true ? null : repository);
  let profile = (await readProfile(path)) ?? empty();
  if (values.approve !== undefined) {
    const approved = proposalProfile(
      await readFile(resolve(values.approve), "utf8"),
      new Date().toISOString(),
    );
    profile = {
      ...approved,
      rules: { ...profile.rules, ...approved.rules },
      guidance: [...new Set([...profile.guidance, ...approved.guidance])],
      sources: [...profile.sources, ...approved.sources],
    };
  }
  const rules: Record<string, string | undefined> = { ...profile.rules };
  let guidance = [...profile.guidance];
  for (const pair of values.set ?? []) {
    const at = pair.indexOf("=");
    const [name, value] = [pair.slice(0, at), pair.slice(at + 1)];
    if (at < 1 || value.length === 0) throw new UsageError("--set takes <rule>=<value>");
    if (name === "guidance") guidance.push(value);
    else rules[name] = value;
  }
  for (const name of values.forget ?? []) {
    if (name === "guidance") guidance = [];
    else if (name in rules) delete rules[name];
    else throw new UsageError(`--forget ${name}: this profile holds no such rule`);
  }
  const checked = conventionSetSchema.safeParse(rules);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new UsageError(`${issue?.path.join(".") || "rule"}: ${issue?.message ?? "not a rule"}`);
  }
  profile = { ...profile, rules: checked.data, guidance, approvedAt: new Date().toISOString() };
  await writeProfile(path, profile);
  show(`${values.global === true ? "global" : "project"} profile ${path}`, profile);
  return 0;
}

/** `doctor --conventions`: each approved profile, and what a run in this repository works under. */
export async function conventionsReport(workspace: string): Promise<number> {
  const home = swarmHome();
  const repository = await repositoryOf(workspace);
  show(`global   ${profilePath(home, null)}`, await readProfile(profilePath(home, null)));
  show(
    `project  ${profilePath(home, repository)}`,
    await readProfile(profilePath(home, repository)),
  );
  const effective = await effectiveConventions(home, repository);
  show(
    `in effect for ${repository}${effective === null ? "" : ` (sha256 ${effective.sha256})`}`,
    effective,
  );
  for (const line of effective?.conflicts ?? []) write(`conflict ${line}`);
  write(
    "Never learned or overridden by a profile: the command policy, the container boundary, the verifier's acceptance rules, and unsafe patterns such as logging credentials.",
  );
  return 0;
}
