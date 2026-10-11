/**
 * Checkouts for the comparison. An arm's workspace is a depth-one clone of the task's base taken
 * from a local mirror through a tag, so the upstream history (which holds the fix and its tests)
 * is not in the object store the agent can read; the remote is removed. The visible check is
 * committed on top of the base as acceptance material both arms see and neither may edit.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const comparisonRoot = join(homedir(), ".cache/swarm-comparison");
export const mirrorOf = (repository) =>
  join(comparisonRoot, "mirrors", `${repository.replace("/", "__")}.git`);
export const tagOf = (task) => `comparison/${task.id}/base`;

/** Paths an arm may create that are not the change: configuration the harness wrote, and acceptance material. */
export const excludedFromPatch = ["acceptance/visible", "swarm.toml", "opencode.json", ".swarm"];

const git = (log, cwd, ...args) => log.run(["git", ...args], { cwd, timeoutMs: 600_000 });

export async function resolveFull(log, task) {
  const resolved = {};
  for (const [key, short] of [
    ["base", task.baseCommit],
    ["upstream", task.upstreamCommit],
  ]) {
    const out = await git(
      log,
      mirrorOf(task.repository),
      "rev-parse",
      "--verify",
      `${short}^{commit}`,
    );
    if (out.exitCode !== 0)
      throw new Error(`${task.id}: ${key} commit ${short} is not in the mirror`);
    resolved[key] = out.stdout.toString().trim();
  }
  const parent = await git(log, mirrorOf(task.repository), "rev-parse", `${resolved.upstream}^`);
  if (parent.stdout.toString().trim() !== resolved.base)
    throw new Error(`${task.id}: the base is not the upstream commit's parent`);
  return resolved;
}

export async function cloneAtBase(log, task, base, directory) {
  const mirror = mirrorOf(task.repository);
  const tag = tagOf(task);
  const tagged = await git(log, mirror, "rev-parse", "--verify", "--quiet", `${tag}^{commit}`);
  if (tagged.exitCode !== 0) await git(log, mirror, "tag", tag, base);
  const cloned = await log.run(
    ["git", "clone", "--quiet", "--depth", "1", "--branch", tag, `file://${mirror}`, directory],
    { cwd: comparisonRoot, timeoutMs: 900_000 },
  );
  if (cloned.exitCode !== 0) throw new Error(`${task.id}: shallow clone failed`);
  await git(log, directory, "checkout", "--quiet", "-b", "work");
  await git(log, directory, "remote", "remove", "origin");
  const head = await git(log, directory, "rev-parse", "HEAD");
  if (head.stdout.toString().trim() !== base)
    throw new Error(`${task.id}: checkout is not at the base`);
}

/** The visible check, committed as the project would keep an acceptance test, and the commit it made. */
export async function commitVisibleCheck(log, task, directory) {
  const path = join(directory, task.visible.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, task.visible.source);
  await git(log, directory, "add", task.visible.path);
  const committed = await git(
    log,
    directory,
    "-c",
    "user.name=comparison",
    "-c",
    "user.email=comparison@localhost",
    "commit",
    "-qm",
    "Visible acceptance check for the task",
  );
  if (committed.exitCode !== 0) throw new Error(`${task.id}: committing the visible check failed`);
  return (await git(log, directory, "rev-parse", "HEAD")).stdout.toString().trim();
}

/** The task's install argv list, in order; false with the failing step when one fails. */
export async function prepare(log, task, directory, { timeoutMs = 900_000 } = {}) {
  for (const argv of task.install) {
    const ran = await log.run(argv, { cwd: directory, timeoutMs, env: installEnvironment() });
    if (ran.exitCode !== 0) return { ok: false, failed: argv, detail: tail(ran) };
  }
  return { ok: true, failed: null, detail: "" };
}

export function installEnvironment() {
  return {
    ...process.env,
    PUPPETEER_SKIP_DOWNLOAD: "true",
    npm_config_fund: "false",
    npm_config_audit: "false",
    npm_config_update_notifier: "false",
  };
}

export function tail(ran, lines = 60) {
  const text = `${ran.stdout.toString()}\n${ran.stderr.toString()}`.trim().split("\n");
  return text.slice(-lines).join("\n");
}

/** The arm's change against the base-plus-acceptance commit, untracked files included, excluding harness files. */
export async function finalPatch(log, directory, base) {
  await git(log, directory, "add", "--all");
  const diff = await git(
    log,
    directory,
    "diff",
    "--cached",
    "--binary",
    base,
    "--",
    ".",
    ...excludedFromPatch.map((path) => `:(exclude)${path}`),
  );
  await git(log, directory, "reset", "--quiet");
  return diff.stdout.toString();
}

export async function applyPatch(log, directory, patch) {
  if (patch.trim() === "") return true;
  const path = join(
    dirname(directory),
    `${createHash("sha256").update(patch).digest("hex").slice(0, 12)}.patch`,
  );
  writeFileSync(path, patch.endsWith("\n") ? patch : `${patch}\n`);
  const applied = await git(log, directory, "apply", "--whitespace=nowarn", path);
  return applied.exitCode === 0;
}

/** Arm configuration the agent needs and the change must not carry. */
export function writeArmConfiguration(directory, arm, endpoint, model) {
  if (arm === "swarm") {
    writeFileSync(
      join(directory, "swarm.toml"),
      `[providers]\nlocal_endpoint = "${endpoint}"\nlocal_thinking = false\n`,
    );
  } else {
    writeFileSync(
      join(directory, "opencode.json"),
      `${JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          provider: {
            rapidmlx: {
              npm: "@ai-sdk/openai-compatible",
              name: "rapid-mlx",
              options: { baseURL: endpoint },
              models: { [model]: { name: model, tool_call: true } },
            },
          },
          model: `rapidmlx/${model}`,
          permission: { edit: "allow", bash: "allow", webfetch: "deny" },
        },
        null,
        2,
      )}\n`,
    );
  }
  appendFileSync(join(directory, ".git/info/exclude"), "\nswarm.toml\nopencode.json\n.swarm/\n");
}
