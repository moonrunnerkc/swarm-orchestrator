/**
 * One launch builder for every arm, and the validation of what it builds before any inference.
 *
 * The 2026-10-22 capability trial lost two of its eight slots before any model call, both to
 * launch commands put together by hand: slot 2 was given a candidate patch staged from the wrong
 * archive root and stopped on ENOENT, and slot 6 omitted the PATH prefix of the pinned OpenCode
 * 1.19.4, so the preflight found the machine's ordinary 1.14.48 and halted
 * (docs/evidence/2026-10-22-capability/protocol.md, amendments 1 and 2). Both were the
 * experimenter's setup, and both consumed a registered slot.
 *
 * Here nothing a launch runs is found by searching PATH and nothing it reads is named by a path
 * relative to wherever the experimenter happened to stand. Executables are absolute pins whose
 * version is asked of the pinned file itself; frozen inputs are found by content digest under
 * registered roots; the environment is built from named entries, never inherited. Every arm runs
 * under one execution profile (macOS Seatbelt through sandbox-exec) that denies reading and
 * writing the hidden evaluators, the mirrors holding reference commits, other launches'
 * directories and this project's checkouts, and admits the launch's own directory. The profile is
 * the same text for every arm, so effective file permissions are equal whatever each product's
 * own policy allows. It is a deny list for named roots: a file's metadata stays visible at an
 * exact path, and network access is not restricted, so the public upstream history remains
 * reachable over the network for every arm alike; the record says so.
 *
 * `validateLaunch` runs the checks a launch depends on with no model call, including an access
 * probe executed inside the same profile and environment the arm gets. A failure there is a
 * zero-inference setup failure, recorded apart from any task outcome.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * The arms a manifest may register. Every `swarm` arm runs the same pinned build and differs only
 * in its frozen flags: `swarm-control` is the product without the flag under study, and
 * `swarm-direct` is an internal ablation with orchestration removed, not an independent competitor.
 */
export const launchArms = ["swarm", "swarm-control", "swarm-direct", "opencode"];
export const isSwarmArm = (arm) =>
  arm === "swarm" || arm === "swarm-control" || arm === "swarm-direct";

export const sandboxExec = "/usr/bin/sandbox-exec";

const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** A path as Seatbelt matches it: resolved through symlinks where it exists (/tmp is /private/tmp). */
function resolvedPath(path) {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

const quote = (path) => JSON.stringify(path);

/**
 * The profile text, in layers where the last matching rule decides: protected roots denied,
 * read-only roots inside them readable again (the frozen tool, a declared package manager),
 * re-protected roots inside those denied again (the tool's documentation and evidence), and the
 * launch's own roots readable and writable. A specific file operation outranks the wildcard form
 * whatever their order (measured on this host: a later `allow file-read*` did not reopen a
 * `deny file-read-data`), so every layer names the same operations. Metadata is left readable so a
 * path through a protected directory still resolves.
 */
export function sandboxProfile({
  protectedRoots,
  readableRoots = [],
  reprotectedRoots = [],
  ownRoots,
}) {
  const subpaths = (roots) =>
    roots.map((root) => `(subpath ${quote(resolvedPath(root))})`).join(" ");
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-read-data file-write* ${subpaths(protectedRoots)})`,
    ...(readableRoots.length === 0 ? [] : [`(allow file-read-data ${subpaths(readableRoots)})`]),
    ...(reprotectedRoots.length === 0
      ? []
      : [`(deny file-read-data file-write* ${subpaths(reprotectedRoots)})`]),
    ...(ownRoots.length === 0 ? [] : [`(allow file-read-data file-write* ${subpaths(ownRoots)})`]),
  ].join("\n");
}

/** The roots every launch of a manifest is denied, with the ones the manifest adds. */
export function protectedRootsOf(manifest, home = homedir()) {
  return [
    join(home, "projects"),
    join(home, ".swarm"),
    join(home, ".claude"),
    join(home, ".cache/swarm-comparison/mirrors"),
    join(home, ".cache/swarm-comparison/blobs"),
    join(home, "swarm-comparison-work"),
    ...(manifest.isolation?.protectedRoots ?? []),
  ];
}

/**
 * A frozen input, found by its content digest under the manifest's registered roots, never by a
 * path the caller computed. Null where no registered file has those bytes.
 */
export function resolveFrozenInput(manifest, input) {
  for (const root of manifest.inputRoots ?? []) {
    const candidate = join(root, input.name);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const bytes = readFileSync(candidate);
      if (digestOf(bytes) === input.digest) return { path: candidate, bytes };
    }
  }
  return null;
}

/**
 * One digest over every file of a built tree, by sorted relative path and bytes. The CLI entry
 * alone is not the build: two builds of 2026-10-22 differed in their agent loop and had the same
 * `dist/cli.js` bytes.
 */
export function treeDigest(directory) {
  const hash = createHash("sha256");
  const files = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .sort();
  for (const file of files) {
    hash.update(`${file.slice(directory.length + 1)}\n`);
    hash.update(readFileSync(file));
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

/** What the pinned executable says its version is, asked of the absolute file itself. */
export function versionOfExecutable(path, versionArgs = ["--version"]) {
  const ran = spawnSync(path, versionArgs, { encoding: "utf8", env: { PATH: dirname(path) } });
  if (ran.error)
    return { ok: false, version: null, problem: String(ran.error.message ?? ran.error) };
  return {
    ok: ran.status === 0,
    version: (ran.stdout || ran.stderr || "").trim().split("\n")[0] ?? "",
  };
}

/**
 * The environment an arm gets: named entries only. PATH holds the pinned node's directory, the
 * task's declared package manager where it declares one, and the system directories, in that
 * order; nothing from the experimenter's shell. HOME is the launch's own.
 */
export function launchEnvironment({ manifest, taskPath, home, scratch, workspace, arm }) {
  const nodeDirectory = dirname(manifest.pins.nodeBin);
  const path = [
    ...(taskPath ?? []),
    nodeDirectory,
    ...(manifest.pins.systemPath ?? ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]),
  ];
  return {
    PATH: [...new Set(path)].join(":"),
    HOME: home,
    PWD: workspace,
    TMPDIR: join(scratch, "tmp"),
    LANG: "en_US.UTF-8",
    TERM: "dumb",
    PUPPETEER_SKIP_DOWNLOAD: "true",
    npm_config_fund: "false",
    npm_config_audit: "false",
    npm_config_update_notifier: "false",
    ...(isSwarmArm(arm) ? { SWARM_CHILD_HOME: home } : {}),
  };
}

/** The flags a manifest may freeze for a Swarm arm, by name and value. */
const swarmArmFlags = {
  "--prompt-profile": ["legacy", "concise"],
  "--adaptive": null,
  "--repair-finish": null,
  "--repair-trace": null,
  "--attempts": ["0", "1", "2", "3"],
};

export function frozenSwarmFlags(flags) {
  const out = [];
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (!(flag in swarmArmFlags)) throw new Error(`${flag} is not a flag a manifest may freeze`);
    out.push(flag);
    const values = swarmArmFlags[flag];
    if (values === null) continue;
    const value = flags[index + 1];
    if (!values.includes(value))
      throw new Error(`${flag} takes ${values.join(" or ")}, not ${value}`);
    out.push(value);
    index += 1;
  }
  return out;
}

/**
 * The inner command of an arm: the absolute pinned executable first, every argument after it.
 * Swarm arms differ only in their frozen flags (`manifest.arms[arm].flags`).
 */
export function armArgv({
  manifest,
  arm,
  task,
  prompt,
  workspace,
  base,
  contractPath,
  remainingMs,
  tokenAllowance,
}) {
  const { pins } = manifest;
  if (isSwarmArm(arm))
    return [
      pins.nodeBin,
      pins.swarmCli,
      prompt,
      "--model",
      `local:${pins.model}`,
      "--local-endpoint",
      pins.endpoint,
      "--workspace",
      workspace,
      "--base",
      base,
      "--goal-contract",
      contractPath,
      ...(task.workType === "upgrade" ? ["--preset", "upgrade"] : []),
      "--install",
      "--lockfile",
      "package-lock.json",
      "--max-tokens",
      String(tokenAllowance),
      "--max-wall-minutes",
      String(Math.max(1, Math.floor(remainingMs / 60_000))),
      "--approve",
      "auto",
      "--no-tui",
      "--no-open-evidence",
      "--json",
      ...frozenSwarmFlags(manifest.arms?.[arm]?.flags ?? []),
    ];
  if (arm === "opencode")
    return [
      pins.opencodeBin,
      "run",
      "--dir",
      workspace,
      "--pure",
      "--format",
      "json",
      "-m",
      `rapidmlx/${pins.model}`,
      "--title",
      "comparison launch",
      prompt,
    ];
  throw new Error(`unknown arm ${arm}`);
}

/** The whole launch: the arm's command inside the shared profile, its environment and its cwd. */
export function buildLaunch({
  manifest,
  arm,
  task,
  prompt,
  workspace,
  base,
  contractPath,
  home,
  scratch,
  remainingMs,
  tokenAllowance,
  taskPath,
  ownRoots = [],
}) {
  const profile = sandboxProfile({
    protectedRoots: protectedRootsOf(manifest),
    readableRoots: manifest.isolation?.readableRoots ?? [],
    reprotectedRoots: manifest.isolation?.reprotectedRoots ?? [],
    ownRoots: [scratch, ...ownRoots, ...(manifest.isolation?.sharedWritable ?? [])],
  });
  const inner = armArgv({
    manifest,
    arm,
    task,
    prompt,
    workspace,
    base,
    contractPath,
    remainingMs,
    tokenAllowance,
  });
  return {
    argv: [sandboxExec, "-p", profile, ...inner],
    inner,
    profile,
    cwd: workspace,
    env: launchEnvironment({ manifest, taskPath, home, scratch, workspace, arm }),
  };
}

/**
 * Every check a launch depends on, with no model call. Each entry names what was checked and
 * what was found; `ok` holds only when all of them do. `probeAccess` is run inside the launch's
 * own profile and environment: a canary in a protected root must be unreadable, another
 * launch's directory unlistable, and the launch's workspace readable and writable.
 */
export function validateLaunch({ manifest, arm, launch, canary, otherLaunch, inputs = [] }) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  const { pins } = manifest;

  check("sandbox-exec present", existsSync(sandboxExec), sandboxExec);
  for (const [name, path] of [
    ["node", pins.nodeBin],
    ...(isSwarmArm(arm) ? [["swarm cli", pins.swarmCli]] : []),
    ...(arm === "opencode" ? [["opencode", pins.opencodeBin]] : []),
  ])
    check(
      `${name} is an absolute pinned file`,
      typeof path === "string" && isAbsolute(path) && existsSync(path),
      String(path),
    );
  if (typeof pins.nodeBin === "string" && existsSync(pins.nodeBin)) {
    const node = versionOfExecutable(pins.nodeBin);
    check(
      "node version",
      node.ok && node.version === pins.node,
      `${node.version ?? node.problem}; pinned ${pins.node}`,
    );
  }
  if (isSwarmArm(arm) && typeof pins.swarmCli === "string" && existsSync(pins.swarmCli)) {
    const observed = digestOf(readFileSync(pins.swarmCli));
    check(
      "swarm cli digest",
      observed === pins.swarmCliDigest,
      `${observed}; pinned ${pins.swarmCliDigest}`,
    );
    const build = treeDigest(dirname(pins.swarmCli));
    check(
      "swarm build digest",
      build === pins.swarmBuildDigest,
      `${build}; pinned ${pins.swarmBuildDigest}`,
    );
  }
  if (arm === "opencode" && typeof pins.opencodeBin === "string" && existsSync(pins.opencodeBin)) {
    const opencode = versionOfExecutable(pins.opencodeBin);
    check(
      "opencode version",
      opencode.ok && opencode.version === pins.opencode,
      `${opencode.version ?? opencode.problem}; pinned ${pins.opencode}`,
    );
  }
  if (isSwarmArm(arm)) {
    try {
      frozenSwarmFlags(manifest.arms?.[arm]?.flags ?? []);
      check("frozen arm flags", true, (manifest.arms?.[arm]?.flags ?? []).join(" ") || "(none)");
    } catch (cause) {
      check("frozen arm flags", false, cause.message);
    }
  }
  for (const input of inputs) {
    const found = resolveFrozenInput(manifest, input);
    check(
      `frozen input ${input.name}`,
      found !== null,
      found === null
        ? `no file with ${input.digest} under ${(manifest.inputRoots ?? []).join(", ") || "no registered root"}`
        : found.path,
    );
  }
  for (const entry of launch.env.PATH.split(":"))
    check(
      `PATH entry ${entry} is absolute and present`,
      isAbsolute(entry) && existsSync(entry),
      entry,
    );
  check("workspace is a git checkout", existsSync(join(launch.cwd, ".git")), launch.cwd);
  check(
    "launch home is fresh and absolute",
    isAbsolute(launch.env.HOME) &&
      existsSync(launch.env.HOME) &&
      readdirSync(launch.env.HOME).every((name) => name === ".npm"),
    `${launch.env.HOME}${existsSync(launch.env.HOME) ? ` holds ${readdirSync(launch.env.HOME).join(", ") || "nothing"}` : " is absent"}`,
  );
  const access = probeAccess({ launch, canary, otherLaunch });
  for (const one of access) checks.push(one);
  return { ok: checks.every((one) => one.ok), checks };
}

/**
 * Access as the arm will have it: a shell run under the same profile, environment and cwd. Each
 * line reports one operation's exit status, read back here; nothing is inferred from the
 * profile's text.
 */
export function probeAccess({ launch, canary, otherLaunch }) {
  const script = [
    `cat ${shellWord(canary)} >/dev/null 2>&1; echo "canary-read=$?"`,
    `ls ${shellWord(otherLaunch)} >/dev/null 2>&1; echo "other-launch-list=$?"`,
    `ls . >/dev/null 2>&1; echo "workspace-list=$?"`,
    `probe=.launch-access-probe; echo x > "$probe" 2>/dev/null; echo "workspace-write=$?"; rm -f "$probe"`,
    `mkdir -p "$TMPDIR" && echo x > "$TMPDIR/probe" 2>/dev/null; echo "tmp-write=$?"`,
  ].join("\n");
  const ran = spawnSync(sandboxExec, ["-p", launch.profile, "/bin/sh", "-c", script], {
    cwd: launch.cwd,
    env: launch.env,
    encoding: "utf8",
  });
  const status = (name) =>
    Number(new RegExp(`^${name}=(\\d+)$`, "m").exec(ran.stdout ?? "")?.[1] ?? Number.NaN);
  return [
    {
      name: "inside the profile: a protected canary is unreadable",
      ok: status("canary-read") !== 0 && !Number.isNaN(status("canary-read")),
      detail: `cat exit ${status("canary-read")} for ${canary}`,
    },
    {
      name: "inside the profile: another launch's directory is unlistable",
      ok: status("other-launch-list") !== 0 && !Number.isNaN(status("other-launch-list")),
      detail: `ls exit ${status("other-launch-list")} for ${otherLaunch}`,
    },
    {
      name: "inside the profile: the workspace is listable",
      ok: status("workspace-list") === 0,
      detail: `ls exit ${status("workspace-list")}`,
    },
    {
      name: "inside the profile: the workspace is writable",
      ok: status("workspace-write") === 0,
      detail: `write exit ${status("workspace-write")}`,
    },
    {
      name: "inside the profile: the launch's temporary directory is writable",
      ok: status("tmp-write") === 0,
      detail: `write exit ${status("tmp-write")}`,
    },
  ];
}

const shellWord = (word) => `'${String(word).replaceAll("'", `'\\''`)}'`;

/**
 * Whether an invocation reached the model, read from the events the arm printed as it ran: Swarm
 * prints a `model-call` event (`swarm.event.v1`) as each request starts, OpenCode a `step_start`
 * before each model turn. One such event means inference began and the outcome is kept; a stream
 * with none shows that no request was made, which is what a zero-inference setup failure is.
 */
export function inferenceBegan(arm, stdout) {
  for (const line of stdout.split("\n")) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      isSwarmArm(arm) &&
      parsed?.schema === "swarm.event.v1" &&
      parsed.event?.type === "model-call"
    )
      return true;
    if (arm === "opencode" && parsed?.type === "step_start") return true;
  }
  return false;
}
