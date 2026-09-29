/**
 * The study's independent plain-CI arm, and the verifier-evidence check, both apart from the
 * verifier's own report.
 *
 * "Original-suite green" was read off the verifier's report (`refusal === null` and a passing
 * `tests` check), so a refused run could never be green and no suite ran independently of the
 * product under study. Here a fresh checkout of the commit is prepared in a fresh container from
 * its lockfile, and the project's own declared test command runs there; the result is recorded
 * as `{ collected, command, exitCode, status, durationMs, outputTail }` with its `setup` (the
 * install and the command environment) beside it. A setup failure is its own status, never a
 * product outcome.
 *
 * Evidence validity is a separate dimension again: the exported bundle's own `verify.mjs` (and
 * `rederive.mjs` when present) is run over the bundle and its exit decides `evidence.valid`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./attempts.mjs";

export const SUITE_STATUSES = ["passed", "failed", "not-collected", "setup-failed"];

// The project's environment first: a command that says `pytest` or `vitest` means the
// project's, installed into the checkout, not the image's. The package manager a lockfile names
// (pnpm, yarn) is installed beside it during preparation, while the registry is reachable, so
// the test command itself needs no network: `npx --package pnpm` at test time fetched pnpm
// from the registry and, with the network off, read as a failed suite.
export const toolsDirectory = ".study-tools";
export const checkPath = `/workspace/.venv/bin:/workspace/node_modules/.bin:/workspace/${toolsDirectory}/node_modules/.bin`;

const lockfiles = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "package-lock.json", manager: "npm" },
  { file: "uv.lock", manager: "uv" },
];

const installCommands = {
  npm: "npm ci --ignore-scripts --no-audit --no-fund",
  pnpm: `npm install --no-save --no-audit --no-fund --prefix ${toolsDirectory} pnpm@10 && ${toolsDirectory}/node_modules/.bin/pnpm install --frozen-lockfile --ignore-scripts`,
  yarn: `npm install --no-save --no-audit --no-fund --prefix ${toolsDirectory} yarn@1 && ${toolsDirectory}/node_modules/.bin/yarn install --frozen-lockfile --ignore-scripts`,
  // Every group and extra: a test runner kept in a `test` group or `dev` extra is still the
  // project's declared runner.
  uv: "uv sync --locked --all-groups --all-extras",
};

const npmPlaceholder = /no test specified/;

/**
 * The project's manifest, lockfile, install command and declared test command at a checkout.
 * `testCommand` is null with a reason when the project declares none.
 */
export function detectProject(root) {
  const present = lockfiles.filter((entry) => existsSync(join(root, entry.file)));
  const hasPackage = existsSync(join(root, "package.json"));
  const hasPyproject = existsSync(join(root, "pyproject.toml"));
  const manifest = hasPackage ? "package.json" : hasPyproject ? "pyproject.toml" : null;
  if (manifest === null)
    return {
      manifest,
      lockfile: null,
      installCommand: null,
      testCommand: null,
      reason: "no supported manifest (package.json or pyproject.toml)",
    };
  const relevant = present.filter((entry) =>
    manifest === "package.json" ? entry.manager !== "uv" : entry.manager === "uv",
  );
  if (relevant.length > 1)
    return {
      manifest,
      lockfile: null,
      installCommand: null,
      testCommand: null,
      reason: `several lockfiles (${relevant.map((entry) => entry.file).join(", ")}); no package manager is selected`,
    };
  const lock = relevant[0] ?? null;
  const installCommand = lock === null ? null : installCommands[lock.manager];
  if (manifest === "package.json") {
    let scripts = {};
    try {
      scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {};
    } catch {
      return {
        manifest,
        lockfile: lock?.file ?? null,
        installCommand,
        testCommand: null,
        reason: "package.json does not parse",
      };
    }
    const manager = lock?.manager ?? "npm";
    if (typeof scripts.test !== "string" || npmPlaceholder.test(scripts.test))
      return {
        manifest,
        lockfile: lock?.file ?? null,
        installCommand,
        testCommand: null,
        reason: "package.json declares no test script",
      };
    return {
      manifest,
      lockfile: lock?.file ?? null,
      installCommand,
      testCommand: manager === "npm" ? "npm test" : manager === "pnpm" ? "pnpm test" : "yarn test",
      declaredBy: "package.json scripts.test",
      reason: null,
    };
  }
  const pyproject = readFileSync(join(root, "pyproject.toml"), "utf8");
  const pytestDeclared =
    /^\[tool\.pytest/m.test(pyproject) ||
    /["']pytest[<>=~!\s"']/.test(pyproject) ||
    existsSync(join(root, "pytest.ini")) ||
    (existsSync(join(root, "setup.cfg")) &&
      /\[tool:pytest\]/.test(readFileSync(join(root, "setup.cfg"), "utf8")));
  if (!pytestDeclared)
    return {
      manifest,
      lockfile: lock?.file ?? null,
      installCommand,
      testCommand: null,
      reason: "pyproject.toml declares no pytest configuration or dependency",
    };
  return {
    manifest,
    lockfile: lock?.file ?? null,
    installCommand,
    testCommand: "python -m pytest",
    declaredBy: "pytest in pyproject.toml",
    reason: null,
  };
}

const registryReach = /request to https?:\/\/registry\.\S+ failed|getaddrinfo \w+ registry\./;

/**
 * System commands the output reports missing (`sh: 1: sqlite3: not found`): gaps of the image,
 * recorded beside the status so a failure they caused can be told apart. The status is not
 * changed by them; the suite did run and did fail in this environment.
 */
export function missingCommands(output) {
  const names = new Set();
  for (const match of String(output ?? "").matchAll(
    /(?:^|\s)(?:\/bin\/)?(?:sh|bash): (?:\d+: )?([\w.+-]+): (?:command )?not found/gm,
  ))
    names.add(match[1]);
  return [...names].sort();
}

/** Whether a manifest declares any dependency an install would have to provide. */
export function declaresDependencies(root, manifest) {
  if (manifest === "package.json") {
    try {
      const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      return ["dependencies", "devDependencies", "optionalDependencies"].some(
        (key) => Object.keys(parsed[key] ?? {}).length > 0,
      );
    } catch {
      return true;
    }
  }
  const text = readFileSync(join(root, "pyproject.toml"), "utf8");
  return (
    /^\s*(dependencies|dev-dependencies)\s*=\s*\[\s*["']/m.test(text) ||
    /^\[(dependency-groups|project\.optional-dependencies)\]/m.test(text)
  );
}

/** How many tests the runner reports it ran, from its own summary line, or null. */
export function collectedCount(output) {
  const text = String(output ?? "");
  let match = text.match(
    /=+ ([^=\n]*\b(?:passed|failed|error|errors|skipped)\b[^=\n]*) in [\d.]+s/,
  );
  if (match !== null) {
    let total = 0;
    for (const part of match[1].matchAll(/(\d+) (passed|failed|errors?|skipped|xfailed|xpassed)/g))
      total += Number(part[1]);
    return total;
  }
  if (/collected 0 items|no tests ran/.test(text)) return 0;
  match = text.match(/^\s*Tests\s+([^\n]+)$/m);
  if (match !== null) {
    let total = 0;
    for (const part of match[1].matchAll(/(\d+) (passed|failed|skipped|todo)/g))
      total += Number(part[1]);
    return total;
  }
  match = text.match(/^Tests:\s+([^\n]+)$/m);
  if (match !== null) {
    const total = match[1].match(/(\d+) total/);
    if (total !== null) return Number(total[1]);
  }
  match = text.match(/^# tests (\d+)$/m) ?? text.match(/^ℹ tests (\d+)$/m);
  if (match !== null) return Number(match[1]);
  const passing = text.match(/^\s*(\d+) passing/m);
  if (passing !== null) {
    const failing = text.match(/^\s*(\d+) failing/m);
    const pending = text.match(/^\s*(\d+) pending/m);
    return Number(passing[1]) + Number(failing?.[1] ?? 0) + Number(pending?.[1] ?? 0);
  }
  if (/No test files found|No tests found/.test(text)) return 0;
  return null;
}

/**
 * The suite's status from what was observed. Setup failure first (it is not a product outcome),
 * then no declared command or nothing collected, then the command's own exit.
 */
export function suiteStatus({ setupFailed, testCommand, exitCode, timedOut, collected }) {
  if (setupFailed) return "setup-failed";
  if (testCommand === null) return "not-collected";
  if (timedOut) return "failed";
  if (collected === 0) return "not-collected";
  if (exitCode === 5 && collected === null) return "not-collected";
  return exitCode === 0 ? "passed" : "failed";
}

const tail = (text, bytes = 4000) => String(text ?? "").slice(-bytes);

/** The pinned image as recorded in `setup.environment`, confirmed against the daemon now. */
export function environmentImage(image, run = spawnSync) {
  if (typeof image === "string") return imageIdentity(image, run);
  const now = imageIdentity(image.reference, run);
  return { ...image, confirmedId: now.id, matches: now.id === image.id };
}

/**
 * An image as the study runs it: a tag resolved once, when a run opens, to an immutable
 * reference and the host's platform. A development row showed why a tag is not enough: the
 * shared docker daemon's `node:24-bookworm` moved between two containers of one row (another
 * process pulled it for linux/amd64), so dependencies installed under emulation for x64 and the
 * check then ran natively on arm64 against them. Every container of a run uses the pinned
 * reference with `--platform`.
 */
export function resolveImage(tag, run = spawnSync) {
  const server = run("docker", ["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"], {
    encoding: "utf8",
  });
  if (server.status !== 0)
    throw new Error(`the container daemon did not answer: ${tail(server.stderr, 300)}`);
  const platform = server.stdout.trim();
  let identity = imageIdentity(tag, run);
  if (identity.id === null) {
    const pulled = run("docker", ["pull", "--quiet", "--platform", platform, tag], {
      encoding: "utf8",
    });
    if (pulled.status !== 0)
      throw new Error(`${tag} could not be pulled: ${tail(pulled.stderr, 300)}`);
    identity = imageIdentity(tag, run);
  }
  const repository = tag.replace(/:[^/:]*$/, "");
  const digest = identity.repoDigests.find((entry) => entry.startsWith(`${repository}@`));
  return {
    tag,
    reference: digest ?? identity.id,
    id: identity.id,
    repoDigests: identity.repoDigests,
    platform,
  };
}

const imageArguments = (image) =>
  typeof image === "string"
    ? [image]
    : [...(image.platform ? [`--platform=${image.platform}`] : []), image.reference];

/** The image's id and repository digest, as docker reports them. */
export function imageIdentity(image, run = spawnSync) {
  const inspected = run(
    "docker",
    ["image", "inspect", "--format", "{{.Id}} {{json .RepoDigests}}", image],
    {
      encoding: "utf8",
    },
  );
  if (inspected.status !== 0)
    return { image, id: null, repoDigests: [], detail: tail(inspected.stderr, 300) };
  const [id, digests] = inspected.stdout.trim().split(" ");
  let repoDigests = [];
  try {
    repoDigests = JSON.parse(digests);
  } catch {
    repoDigests = [];
  }
  return { image, id, repoDigests };
}

/**
 * Prepare dependencies at a checkout in a container with the registry reachable for this one
 * command, install scripts off. Returns the structured `setup.install` record.
 */
export function prepareDependencies(root, image, project, { timeoutMs, run = spawnSync }) {
  if (project.installCommand === null) {
    // Nothing to install is not a failure; dependencies with no lockfile to install them from
    // are, since the arm installs only what a lockfile pins.
    const needed = project.manifest !== null && declaresDependencies(root, project.manifest);
    return {
      command: null,
      lockfile: project.lockfile,
      lockfileDigest: null,
      status: needed ? "failed" : "not-needed",
      detail: needed
        ? (project.reason ?? "the manifest declares dependencies and no lockfile pins them")
        : "the manifest declares no dependencies",
      exitCode: null,
      durationMs: 0,
      outputTail: "",
    };
  }
  const started = Date.now();
  const ran = run(
    "docker",
    [
      "run",
      "--rm",
      "--network=bridge",
      `--volume=${root}:/workspace:rw`,
      "--workdir=/workspace",
      "--memory=4g",
      "--entrypoint",
      "/bin/sh",
      ...imageArguments(image),
      "-c",
      `export HOME=/tmp TMPDIR=/tmp; ${project.installCommand}`,
    ],
    { encoding: "utf8", maxBuffer: 256_000_000, timeout: timeoutMs },
  );
  const timedOut = ran.signal === "SIGTERM";
  return {
    command: project.installCommand,
    lockfile: project.lockfile,
    lockfileDigest: sha256(readFileSync(join(root, project.lockfile))),
    status: ran.error === undefined && !timedOut && ran.status === 0 ? "installed" : "failed",
    exitCode: ran.status,
    timedOut,
    durationMs: Date.now() - started,
    outputTail: tail(`${ran.stdout ?? ""}\n${ran.stderr ?? ""}`),
  };
}

/** Run a command at a checkout in a network-disabled container with the project's PATH first. */
export function runInContainer(
  root,
  image,
  command,
  { timeoutMs, run = spawnSync, memory = "4g" },
) {
  const started = Date.now();
  const ran = run(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      `--volume=${root}:/workspace:rw`,
      "--workdir=/workspace",
      `--memory=${memory}`,
      "--pids-limit=512",
      "--entrypoint",
      "/bin/sh",
      ...imageArguments(image),
      "-c",
      `export HOME=/tmp TMPDIR=/tmp PATH=${checkPath}:$PATH; ${command}`,
    ],
    { encoding: "utf8", maxBuffer: 256_000_000, timeout: timeoutMs },
  );
  return {
    exitCode: ran.status,
    timedOut: ran.signal === "SIGTERM",
    error: ran.error?.message ?? null,
    durationMs: Date.now() - started,
    stdout: ran.stdout ?? "",
    stderr: ran.stderr ?? "",
  };
}

/**
 * The plain-CI arm at one checkout: detect, prepare, run the declared test command. The
 * checkout must be fresh (made for this run); nothing of the verifier's is read.
 */
export function plainSuite(root, { image, installTimeoutMs, testTimeoutMs, run = spawnSync }) {
  const project = detectProject(root);
  const environment = {
    image: environmentImage(image, run),
    path: `${checkPath}:<image PATH>`,
    network: { install: "bridge (registry, this one command)", test: "none" },
  };
  const install = prepareDependencies(root, image, project, { timeoutMs: installTimeoutMs, run });
  const setup = { install, environment };
  const setupFailed = install.status === "failed";
  if (setupFailed || project.testCommand === null) {
    return {
      setup,
      suite: {
        command: project.testCommand,
        declaredBy: project.declaredBy ?? null,
        collected: null,
        exitCode: null,
        status: suiteStatus({ setupFailed, testCommand: project.testCommand }),
        reason: setupFailed
          ? `dependency preparation failed: ${install.detail ?? `exit ${install.exitCode}`}`
          : project.reason,
        durationMs: 0,
        outputTail: "",
      },
    };
  }
  const ran = runInContainer(root, image, project.testCommand, { timeoutMs: testTimeoutMs, run });
  const output = `${ran.stdout}\n${ran.stderr}`;
  const collected = collectedCount(output);
  // A test command that could not start without the registry never ran the suite: that is the
  // environment's, not the project's outcome.
  const neededRegistry = ran.exitCode !== 0 && collected === null && registryReach.test(output);
  return {
    setup,
    suite: {
      command: project.testCommand,
      declaredBy: project.declaredBy,
      collected,
      exitCode: ran.exitCode,
      timedOut: ran.timedOut,
      environmentGaps: missingCommands(output),
      status: suiteStatus({
        setupFailed: neededRegistry,
        testCommand: project.testCommand,
        exitCode: ran.exitCode,
        timedOut: ran.timedOut,
        collected,
      }),
      reason: neededRegistry
        ? "the test command reached for the package registry with the network off, so no test ran"
        : null,
      durationMs: ran.durationMs,
      outputTail: tail(output),
    },
  };
}

/**
 * Whether the verifier's exported bundle verifies by its own embedded verifier. `verify.mjs`
 * must exit 0; `rederive.mjs`, where the bundle has one, must exit 0 too. A missing bundle or
 * a missing verifier is invalid with that reason.
 */
export function bundleEvidence(bundle, { run = spawnSync, node = process.execPath } = {}) {
  if (bundle === null || bundle === undefined || !existsSync(bundle))
    return { valid: false, detail: "no bundle was exported" };
  if (!existsSync(join(bundle, "verify.mjs")))
    return { valid: false, detail: "the bundle carries no verify.mjs" };
  const checks = [];
  for (const script of ["verify.mjs", "rederive.mjs"]) {
    if (!existsSync(join(bundle, script))) continue;
    const ran = run(node, [script, "."], {
      cwd: bundle,
      encoding: "utf8",
      timeout: 300_000,
      env: { PATH: process.env.PATH ?? "", NO_COLOR: "1" },
    });
    checks.push({
      script,
      exitCode: ran.status,
      lastLine:
        String(ran.stdout ?? "")
          .trim()
          .split("\n")
          .at(-1) ?? "",
      stderrTail: tail(ran.stderr, 600),
    });
  }
  const failed = checks.filter((check) => check.exitCode !== 0);
  return {
    valid: failed.length === 0,
    detail:
      failed.length === 0
        ? checks.map((check) => `${check.script}: ${check.lastLine}`).join("; ")
        : failed
            .map(
              (check) =>
                `${check.script} exited ${check.exitCode}: ${check.lastLine || check.stderrTail}`,
            )
            .join("; "),
    checks,
  };
}
