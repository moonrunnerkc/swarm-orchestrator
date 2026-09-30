/**
 * Checkouts and prepared environments for the campaign.
 *
 * A launch's checkout is a depth-one clone of the goal's pinned base, taken from a local mirror
 * through a tag, so the commit keeps its upstream identity while the history after it (which may
 * hold the upstream fix and its tests) is not in the object store an agent can read. Every arm and
 * the truth scorer prepare dependencies with the goal's own install argv, lifecycle scripts off,
 * inside a container with registry access; everything after the install runs with the network off.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const campaignRoot = join(homedir(), ".cache/swarm-campaign");
export const mirrorOf = (repository) =>
  join(campaignRoot, "mirrors", `${repository.replace("/", "__")}.git`);
export const baseTagOf = (goal) => `campaign/${goal.id}/base`;

/** Images per purpose. The browser image is the one the verifier's sealed instrument requires. */
export const images = {
  node: "node:24-bookworm",
  python: "swarm-upgrade-python:20260927",
  browser: "swarm-upgrade-browser:20260927",
};

export const cacheDirectory = join(campaignRoot, "docker-cache");

const git = (log, cwd, ...args) => log.run(["git", ...args], { cwd, timeoutMs: 600_000 });

/** A shallow checkout of the goal's base on a branch named `campaign`, verified by commit id. */
export async function cloneAtBase(log, goal, directory) {
  const mirror = mirrorOf(goal.repository);
  const tag = baseTagOf(goal);
  const tagged = await git(log, mirror, "rev-parse", "--verify", "--quiet", `${tag}^{commit}`);
  if (tagged.exitCode !== 0) {
    const made = await git(log, mirror, "tag", tag, goal.upstreamBase);
    if (made.exitCode !== 0)
      throw new Error(`${goal.id}: cannot tag ${goal.upstreamBase} in the mirror`);
  } else if (tagged.stdout.toString().trim() !== goal.upstreamBase)
    throw new Error(`${goal.id}: mirror tag ${tag} names another commit`);
  const cloned = await log.run(
    ["git", "clone", "--quiet", "--depth", "1", "--branch", tag, `file://${mirror}`, directory],
    { cwd: campaignRoot, timeoutMs: 900_000 },
  );
  if (cloned.exitCode !== 0) throw new Error(`${goal.id}: shallow clone failed`);
  await git(log, directory, "checkout", "--quiet", "-b", "campaign");
  await git(log, directory, "remote", "remove", "origin");
  const head = await git(log, directory, "rev-parse", "HEAD");
  if (head.stdout.toString().trim() !== goal.upstreamBase)
    throw new Error(`${goal.id}: the checkout is not at the pinned base`);
}

/** Apply a patch to the working tree; false when it does not apply. */
export async function applyPatch(log, directory, patch, name) {
  if (patch.trim() === "") return true;
  const path = join(directory, "..", `${name}.patch`);
  writeFileSync(path, patch.endsWith("\n") ? patch : `${patch}\n`);
  const applied = await git(log, directory, "apply", "--whitespace=nowarn", path);
  return applied.exitCode === 0;
}

/**
 * The working tree's change against the base, untracked files included, as a binary diff, with
 * `excluded` paths (committed acceptance material) left out.
 */
export async function finalPatch(log, directory, base, excluded = []) {
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
    ...excluded.map((path) => `:(exclude)${path}`),
  );
  await git(log, directory, "reset", "--quiet");
  return diff.stdout.toString();
}

/** docker argv for one step in a prepared environment over a mounted checkout. */
export function containerArgv({ image, directory, argv, network, env = {}, extraMounts = [] }) {
  mkdirSync(cacheDirectory, { recursive: true });
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  const environment = {
    HOME: "/cache/home",
    npm_config_cache: "/cache/npm",
    npm_config_store_dir: "/cache/pnpm-store",
    COREPACK_HOME: "/cache/corepack",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    UV_CACHE_DIR: "/cache/uv",
    UV_PYTHON_INSTALL_DIR: "/cache/uv-python",
    UV_LINK_MODE: "copy",
    // A container has no git identity; suites that commit into fixtures need one, as a CI runner
    // provides.
    GIT_AUTHOR_NAME: "campaign",
    GIT_AUTHOR_EMAIL: "campaign@localhost",
    GIT_COMMITTER_NAME: "campaign",
    GIT_COMMITTER_EMAIL: "campaign@localhost",
    PATH: "/w/node_modules/.bin:/w/.venv/bin:/cache/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    ...env,
  };
  return [
    "docker",
    "run",
    "--rm",
    "--name",
    `campaign-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    "--network",
    network ? "bridge" : "none",
    "--memory",
    "6g",
    "--user",
    `${uid}:${gid}`,
    "-v",
    `${directory}:/w`,
    "-v",
    `${cacheDirectory}:/cache`,
    ...extraMounts.flatMap((mount) => ["-v", mount]),
    "-w",
    "/w",
    ...Object.entries(environment).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    image,
    ...argv,
  ];
}

/** Whether a patch changes anything the install reads, so a prepared tree cannot be reused. */
export function touchesInstallInputs(patch) {
  return /^diff --git a\/(?:\S*\/)?(?:package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|pyproject\.toml|uv\.lock|\.python-version) /m.test(
    patch,
  );
}

/**
 * The image a goal's checks run in. A pnpm goal gets the Node image with its lockfile's exact pnpm
 * activated at build time, because the verifier disables implicit Corepack downloads and a check
 * with the network off cannot fetch a package manager. A browser goal runs everything in the
 * browser image, as the verifier's sealed instrument requires.
 */
export function imageFor(goal, contract = null) {
  if (contract?.checks.some((check) => check.behavior?.kind === "browser")) return images.browser;
  if (goal.ecosystem === "python") return images.python;
  if (goal.manager === "pnpm") return `swarm-campaign-node:pnpm-${goal.managerVersion}`;
  return images.node;
}

/** Build the pnpm image a goal needs if it is not already present. */
export async function ensureImage(log, goal) {
  const image = imageFor(goal);
  if (!image.startsWith("swarm-campaign-node:")) return image;
  const present = await log.run(["docker", "image", "inspect", image], {
    cwd: campaignRoot,
    timeoutMs: 60_000,
  });
  if (present.exitCode === 0) return image;
  const built = await log.run(["docker", "build", "-t", image, "-"], {
    cwd: campaignRoot,
    timeoutMs: 1_800_000,
    // A global install, not a Corepack shim: the shim would fetch again for the unprivileged user.
    input: `FROM ${images.node}\nRUN npm install -g pnpm@${goal.managerVersion} && pnpm --version\n`,
  });
  if (built.exitCode !== 0) throw new Error(`${goal.id}: could not build ${image}`);
  return image;
}

/** Install the goal's dependencies in its image with registry access, lifecycle scripts off. */
export async function prepareDependencies(log, goal, directory) {
  const image = await ensureImage(log, goal);
  for (const argv of goal.install) {
    const ran = await log.run(containerArgv({ image, directory, argv, network: true }), {
      cwd: directory,
      timeoutMs: 1_800_000,
    });
    if (ran.exitCode !== 0) return { ok: false, failed: argv };
  }
  return { ok: true, failed: null };
}

/**
 * The same install on the host, for an agent's workspace: the agent and its own checks run on
 * this machine, where binaries built for the container's Linux would not load. pnpm is the
 * lockfile's exact version through Corepack; the argv is otherwise the goal's own.
 */
export async function prepareDependenciesOnHost(log, goal, directory) {
  for (const argv of goal.install) {
    const command =
      argv[0] === "pnpm" ? ["corepack", `pnpm@${goal.managerVersion}`, ...argv.slice(1)] : argv;
    const ran = await log.run(command, {
      cwd: directory,
      timeoutMs: 1_800_000,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", UV_PYTHON: "3.11" },
    });
    if (ran.exitCode !== 0) return { ok: false, failed: command };
  }
  return { ok: true, failed: null };
}

/**
 * Whether swarm-verify performs its own install (`--install`) or stages the environment the goal's
 * install already prepared. Its own Python install syncs only the default dependency groups, so a
 * project whose test runner lives in another group would read as unmeasured for a reason that is
 * about preparation, not verification; the verifier's documented alternative is an existing
 * `.venv`, which it copies into its owned checkout. An upgrade must be installed by the verifier
 * (it refuses otherwise), and its clone never carries Node dependencies.
 */
export function verifierInstalls(goal, contract) {
  return goal.ecosystem === "node" || contract.preset?.kind === "upgrade";
}
