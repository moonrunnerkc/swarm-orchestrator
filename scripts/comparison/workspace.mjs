/**
 * Checkouts for the comparison. An arm's workspace is a depth-one clone of the task's base taken
 * from a local mirror through a tag, so the upstream history (which holds the fix and its tests)
 * is not in the object store the agent can read; the remote is removed. The visible check is
 * committed on top of the base as acceptance material both arms see and neither may edit.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";

export const comparisonRoot = join(homedir(), ".cache/swarm-comparison");

/**
 * Where launch and scoring checkouts live: outside any hidden directory. A project's own tools
 * may skip a dot-named path component anywhere in a file's absolute path (css-select's Biome
 * configuration excludes every path matching `**\/.*`), and under ~/.cache that turned the
 * project's lint into "no files were processed" and its test script into a failure at the base,
 * for every arm, whatever the change.
 */
export const workRoot = join(homedir(), "swarm-comparison-work");

/**
 * The one download cache every launch shares: npm's content-addressed store. A package tarball
 * is the same bytes whichever launch fetched it, and `npm ci` installs the lockfile's exact
 * versions either way, so the logical installed environment is equivalent; what the sharing
 * changes is whether a launch pays the registry's time, and that policy is declared here and
 * in each record rather than left to whichever launch ran first.
 */
export const sharedNpmCache = join(comparisonRoot, "npm-cache");

/**
 * The mutable state one launch's processes get: a HOME of its own, created here and never seen
 * by another launch, so a browser one launch's repair installs or a sentinel it writes is absent
 * for the next. Inside it, npm's store is a link to the shared content-addressed cache above;
 * everything else npm or any other tool writes under HOME stays with the launch.
 */
export function prepareLaunchHome(home) {
  if (existsSync(home)) throw new Error(`${home} already exists; a launch home must be fresh`);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(join(sharedNpmCache, "_cacache"), { recursive: true });
  mkdirSync(join(home, ".npm"), { recursive: true });
  symlinkSync(join(sharedNpmCache, "_cacache"), join(home, ".npm", "_cacache"));
  return {
    home,
    npmCache: `${join(sharedNpmCache, "_cacache")} (content-addressed, shared by link)`,
  };
}

/** Where Playwright keeps the browsers it downloads under a HOME, on macOS and on Linux. */
export const browserCachePaths = ["Library/Caches/ms-playwright", ".cache/ms-playwright"];

/** Whether a HOME holds a downloaded browser cache: the prerequisite the pilot's upgrade launch installed. */
export const browserCacheIn = (home) =>
  browserCachePaths.some((path) => existsSync(join(home, path)));
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
  // Forced: the check is the harness's own file, and a repository whose .gitignore admits only
  // listed paths (node-tar ignores every root entry it does not name) would otherwise refuse it.
  await git(log, directory, "add", "--force", task.visible.path);
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
    const ran = await log.run(argv, { cwd: directory, timeoutMs, env: taskEnvironment(task) });
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
    // The harness's own installs fill the same content-addressed store the launches read.
    npm_config_cache: sharedNpmCache,
  };
}

/** Where the harness keeps a package manager release a task's base declares. */
export const npmToolchain = (version) => join(comparisonRoot, "tools", `npm-${version}`);

const declaredNpmCache = new Map();

/**
 * The npm release a task's base declares in its manifest (`packageManager: "npm@11.2.0"`), read
 * from the sealed mirror so no change an arm makes can move it; null where it declares none.
 */
export function declaredNpm(task) {
  if (declaredNpmCache.has(task.id)) return declaredNpmCache.get(task.id);
  const shown = spawnSync("git", ["show", `${task.baseCommit}:package.json`], {
    cwd: mirrorOf(task.repository),
    encoding: "utf8",
  });
  let version = null;
  if (shown.status === 0) {
    const declared = JSON.parse(shown.stdout).packageManager;
    const match = typeof declared === "string" ? /^npm@(\d+\.\d+\.\d+)/.exec(declared) : null;
    version = match?.[1] ?? null;
  }
  declaredNpmCache.set(task.id, version);
  return version;
}

/**
 * The environment every command of a task runs in, the arms' included: the install
 * environment, with the npm release the base declares first on PATH where it declares one. A
 * project that pins its package manager is prepared with that one; Swarm refuses to spend model
 * calls in an environment other than the declared one, and both arms get the same.
 */
export function taskEnvironment(task) {
  const environment = installEnvironment();
  const version = declaredNpm(task);
  if (version === null) return environment;
  const bin = join(npmToolchain(version), "node_modules", ".bin");
  if (!existsSync(join(bin, "npm")))
    throw new Error(
      `${task.id} declares npm@${version} and it is not provisioned; before freezing run: npm install --prefix ${npmToolchain(version)} --no-audit --no-fund npm@${version}`,
    );
  return { ...environment, PATH: `${bin}:${environment.PATH}` };
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

/**
 * The one word shape a gate override may be built from: the task's own argv words, as the
 * protocol freezes them. A word a shell could read otherwise (a quote, a space, a redirect, a
 * substitution) is refused rather than escaped, since the override runs through the product's
 * own shell and the only safe serialization of something this cannot read is none.
 */
const plainArgvWord = /^[A-Za-z0-9_./:=@+-]+$/;

/**
 * The gate overrides Swarm is given, derived from the frozen task: the project test command
 * both arms are told about becomes the product's blocking `tests` gate. Without this the
 * product assembled its own gate from the manifest's `test` script, and ran chai's browser
 * suite while the task named `npm run test-node`.
 */
export function swarmGateOverrides(task, declared = {}) {
  for (const word of task.projectTest)
    if (!plainArgvWord.test(word))
      throw new Error(
        `${task.id}: the project test word ${JSON.stringify(word)} cannot be written as a gate override; the frozen argv must be plain words`,
      );
  return { ...advisoryGates(task, declared), tests: { command: task.projectTest.join(" ") } };
}

/**
 * Gates the manifest declares advisory for a task: a check the product would make blocking that
 * the task's own base already fails (mime's Prettier lint), which the task does not hold either
 * arm to. Only the severity changes; the command is the product's own, so the gate is still
 * run and reported. Nothing else may be declared: not the tests gate, not a stricter severity,
 * not a command the product would not run.
 */
function advisoryGates(task, declared) {
  const gates = {};
  for (const [id, gate] of Object.entries(declared)) {
    if (
      id === "tests" ||
      gate.severity !== "advisory" ||
      !gate.command.split(" ").every((word) => plainArgvWord.test(word)) ||
      !/^npm run --loglevel=error [\w:.-]+$/.test(gate.command)
    )
      throw new Error(
        `${task.id}: the declared gate ${id} ${JSON.stringify(gate)} is not an advisory product gate`,
      );
    gates[id] = { command: gate.command, severity: "advisory" };
  }
  return gates;
}

/** The swarm.toml an arm's workspace gets, serialized rather than concatenated. */
export function swarmConfigurationText(endpoint, task, declared = {}) {
  const text = stringifyToml({
    providers: { local_endpoint: endpoint, local_thinking: false },
    gates: swarmGateOverrides(task, declared),
  });
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * Arm configuration the agent needs and the change must not carry. `declared` is the manifest's
 * advisory gates for the task (Swarm only).
 */
export function writeArmConfiguration(directory, arm, endpoint, model, task, declared = {}) {
  if (arm === "swarm") {
    writeFileSync(join(directory, "swarm.toml"), swarmConfigurationText(endpoint, task, declared));
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
              // The same per-call output cap Swarm uses (8192); OpenCode's default for an
              // unlisted model asks for 32000, which this server cannot serve in one call.
              // Thinking off, as Swarm sends it: the server enables thinking for any model
              // not named "coder", and a turn spent thinking to the cap answers nothing.
              // OpenCode merges a model's options into the request body as they are, so the
              // keys are the server's own field names. Swarm sends no sampling fields and
              // gets the server's defaults; OpenCode sends top_p 1 of its own, so the
              // server's default top_p (0.95) is named here for the same sampling.
              models: {
                [model]: {
                  name: model,
                  tool_call: true,
                  limit: { context: 131072, output: 8192 },
                  // Three spellings of "do not think", for the servers that read each: rapid-mlx
                  // and vLLM the templated enable_thinking, Ollama reasoning_effort (its
                  // OpenAI route ignores the other two). Swarm sends the same three. The last
                  // is spelled as the SDK's own option: OpenCode's provider maps reasoningEffort
                  // to the wire field and overwrites a reasoning_effort given directly, which a
                  // proxy capture of the canary showed arriving without it.
                  options: {
                    enable_thinking: false,
                    chat_template_kwargs: { enable_thinking: false },
                    reasoningEffort: "none",
                    top_p: 0.95,
                  },
                },
              },
            },
          },
          model: `rapidmlx/${model}`,
          // The machine's global OpenCode configuration names a small model on another server
          // for its thread-title call; a refused connection there ended a run before its first
          // output. Every call of the arm goes to the one pinned model.
          small_model: `rapidmlx/${model}`,
          permission: { edit: "allow", bash: "allow", webfetch: "deny" },
        },
        null,
        2,
      )}\n`,
    );
  }
  appendFileSync(join(directory, ".git/info/exclude"), "\nswarm.toml\nopencode.json\n.swarm/\n");
}
