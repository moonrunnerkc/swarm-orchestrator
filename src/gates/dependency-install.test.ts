import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { archiveExtractScript, archiveFetchScript, pep517BuildScript } from "./deferred-setup.ts";
import {
  installFromLockfile,
  lockfileInstallerArgv,
  pnpmForLockfileText,
} from "./dependency-install.ts";
import type { CommandOptions, GateObservation } from "./gate-definition.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

const execute = promisify(execFile);
const clock = createSystemClock();
let root = "";
let workspace = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-dependency-"));
  workspace = join(root, "repo");
  await execute("git", ["init", "--quiet", workspace]);
  await writeFile(join(workspace, ".gitignore"), "node_modules/\n");
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: { prepare: "node -e \"require('fs').writeFileSync('lifecycle-ran','yes')\"" },
    }),
  );
  await writeFile(
    join(workspace, "package-lock.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "fixture", version: "1.0.0" } },
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const settings = async () => ({
  workspace,
  timeoutMs: 30000,
  commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
  evidence: await openEvidenceSession({ root: join(root, "sessions"), sessionId: "setup", clock }),
});

it("executes real frozen setup without lifecycle scripts, recording intent before completion", async () => {
  const options = await settings();
  const observed = await installFromLockfile(options);
  expect(observed.succeeded).toBe(true);
  await expect(access(join(workspace, "lifecycle-ran"))).rejects.toThrow();
  expect(
    options.evidence
      .records()
      .map((record) => options.evidence.payloads().get(record.payloadDigest)),
  ).toMatchObject([
    { phase: "intent", argv: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"] },
    { phase: "completed", succeeded: true },
  ]);
});

it("refuses an installer that changes source despite exit zero", async () => {
  const options = await settings();
  const observed = await installFromLockfile({
    ...options,
    commands: {
      ...options.commands,
      runVouched: async (_argv, invocation) => {
        expect(invocation.timeoutMs).toBe(17);
        await writeFile(join(workspace, "package.json"), "{}\n");
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, unavailable: null };
      },
    },
    timeoutMs: 17,
  });
  expect(observed.succeeded).toBe(false);
  expect(observed.detail).toContain("changed source");
  expect(await readFile(join(workspace, "package.json"), "utf8")).toBe("{}\n");
});

it("preserves an ambiguous setup and refuses to execute it again", async () => {
  const options = await settings();
  let launches = 0;
  const commands = {
    ...options.commands,
    runVouched: async () => {
      launches++;
      throw new Error("lost process observation");
    },
  };
  await expect(installFromLockfile({ ...options, commands })).rejects.toThrow("lost process");
  await expect(installFromLockfile({ ...options, commands })).rejects.toThrow("unresolved effect");
  expect(launches).toBe(1);
  expect(options.evidence.records()).toHaveLength(1);
});

it("does not reserve or launch setup after cancellation", async () => {
  const options = await settings();
  await expect(
    installFromLockfile({ ...options, signal: AbortSignal.abort(new Error("cancelled")) }),
  ).rejects.toThrow("cancelled");
  expect(options.evidence.records()).toHaveLength(0);
});
it("preserves an independent checkout when setup completion is unknown", async () => {
  await execute("git", ["add", "."], { cwd: workspace });
  await execute(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--quiet",
      "-m",
      "base",
    ],
    { cwd: workspace },
  );
  const options = await settings();
  let preserved = "";
  await expect(
    verifyIndependently({
      repositoryRoot: workspace,
      baseCommit: "HEAD",
      patch: "",
      checkoutRoot: root,
      clock,
      installDependencies: true,
      commands: {
        ...options.commands,
        runVouched: async (argv, invocation) => {
          if (argv[0] !== "npm") return options.commands.runVouched(argv, invocation);
          preserved = invocation.cwd;
          await writeFile(join(preserved, "setup-effect"), "must survive reconciliation");
          throw new Error("lost installer observation");
        },
      },
    }),
  ).rejects.toThrow("lost installer observation");
  expect(preserved).toContain("swarm-verify-");
  expect(await readFile(join(preserved, "setup-effect"), "utf8")).toBe(
    "must survive reconciliation",
  );
  await expect(access(join(preserved, ".git"))).resolves.toBeUndefined();
});

/**
 * thesvg, in the pull request study: a pnpm lockfile, no packageManager pin, and an image
 * with no pnpm, so the plain `pnpm install` could not start. The lockfile's own format names
 * the major that reads it; that major's latest is fetched and named in the command.
 */
it("chooses the pnpm major from an unpinned lockfile's format", () => {
  expect(pnpmForLockfileText("lockfileVersion: '9.0'\n")).toBe("10");
  expect(pnpmForLockfileText('lockfileVersion: "6.0"\n')).toBe("8");
  expect(pnpmForLockfileText("lockfileVersion: 5.4\n")).toBe("7");
  expect(pnpmForLockfileText("settings: {}\n")).toBe("latest");
});

/**
 * A project that keeps its test runner in a non-default dependency group, or in a `dev` extra as
 * the older layout does, is still run. `--no-build` keeps the registry-reaching install from
 * running any build backend: a source archive's setup.py and a workspace member's build both ran
 * there with the network on before.
 */
it("installs every dependency group and every extra of a uv project, building nothing", () => {
  expect(lockfileInstallerArgv("uv.lock")).toEqual([
    "uv",
    "sync",
    "--locked",
    "--all-groups",
    "--all-extras",
    "--no-install-project",
    "--no-build",
  ]);
});

/**
 * The work a scripts-off install leaves undone. Each case drives the recorded effects through a
 * runner that answers as the real tools do, with the check-time network measurement injected,
 * so what is asserted is which commands run, with which network, and what the ledger says.
 */
describe("deferred setup after the scripts-off install", () => {
  const ok = (stdout = ""): GateObservation => ({
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
    unavailable: null,
  });
  type Call = { argv: readonly string[]; options: CommandOptions };
  const scripted = (
    answer: (argv: readonly string[]) => Promise<GateObservation> | GateObservation,
  ) => {
    const calls: Call[] = [];
    return {
      calls,
      commands: {
        run: async () => ok(),
        runVouched: async (argv: readonly string[], options: CommandOptions) => {
          calls.push({ argv, options });
          return answer(argv);
        },
      },
    };
  };
  const refused = async () => ({ contained: true, observed: "could not reach the endpoint" });
  const payloads = (evidence: Awaited<ReturnType<typeof settings>>["evidence"]) =>
    evidence.records().map((record) => evidence.payloads().get(record.payloadDigest));

  beforeEach(async () => {
    await writeFile(
      join(workspace, "package-lock.json"),
      JSON.stringify({
        name: "fixture",
        lockfileVersion: 3,
        packages: {
          "": { name: "fixture", version: "1.0.0" },
          "node_modules/native-binding": { version: "1.0.0", hasInstallScript: true },
        },
      }),
    );
    await mkdir(join(workspace, "node_modules", "native-binding"), { recursive: true });
    await writeFile(join(workspace, "node_modules", "native-binding", "package.json"), "{}\n");
  });

  it("runs a dependency's deferred install script offline where the checks run, and records it", async () => {
    const options = await settings();
    const { calls, commands } = scripted((argv) =>
      argv[0] === "node" ? ok("/usr/local") : ok("rebuilt dependencies successfully"),
    );
    const observed = await installFromLockfile({ ...options, commands, probeNetwork: refused });
    expect(observed.succeeded).toBe(true);
    expect(observed.command).toBe("npm ci --ignore-scripts --no-audit --no-fund");
    expect(observed.detail).toContain(
      "install scripts of 1 dependency (native-binding) ran offline where the checks run (network measured off)",
    );
    const rebuild = calls.find((call) => call.argv[1] === "rebuild");
    expect(rebuild?.argv).toEqual([
      "npm",
      "rebuild",
      "--foreground-scripts",
      "--nodedir=/usr/local",
      "native-binding",
    ]);
    // The check policy: no registry access asked for, which the runner reads as none.
    expect(rebuild?.options.network).toBeUndefined();
    expect(calls.find((call) => call.argv[1] === "ci")?.options.network).toBe("registry");
    expect(payloads(options.evidence)).toMatchObject([
      {
        phase: "intent",
        network: "registry",
        argv: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      },
      { phase: "completed", succeeded: true },
      {
        phase: "intent",
        network: "none",
        stage: "offline-lifecycle",
        networkProbe: { contained: true },
        argv: rebuild?.argv,
      },
      { phase: "completed", succeeded: true, network: "none", stage: "offline-lifecycle" },
    ]);
    expect(payloads(options.evidence)[0]).not.toHaveProperty("stage");
  });

  it("never runs a deferred script where the checks' network is reachable or unmeasured, and says so", async () => {
    for (const [probe, reason] of [
      [{ contained: false, observed: "reached" }, "a check-time command here reaches the network"],
      [{ contained: null, observed: "no host endpoint" }, "could not be shown (no host endpoint)"],
    ] as const) {
      const options = await settings();
      const { calls, commands } = scripted(() => ok());
      const observed = await installFromLockfile({
        ...options,
        commands,
        probeNetwork: async () => probe,
      });
      expect(observed.succeeded).toBe(true);
      expect(observed.detail).toContain(
        "install scripts of 1 dependency (native-binding) did not run",
      );
      expect(observed.detail).toContain(reason);
      expect(calls.map((call) => call.argv[1])).toEqual(["ci"]);
      expect(options.evidence.records()).toHaveLength(2);
      await rm(join(root, "sessions"), { recursive: true, force: true });
    }
  });

  it("reports a deferred script that failed offline, with its own output, and still measures the tree", async () => {
    const options = await settings();
    const { commands } = scripted((argv) =>
      argv[1] === "rebuild"
        ? {
            ...ok(),
            exitCode: 1,
            stderr: "install script network attempt refused: EAI_AGAIN",
          }
        : ok(),
    );
    const observed = await installFromLockfile({ ...options, commands, probeNetwork: refused });
    expect(observed.succeeded).toBe(true);
    expect(observed.detail).toContain(
      "failed (exit 1): install script network attempt refused: EAI_AGAIN",
    );
    expect(observed.detail).toContain("the running node carries no headers");
    expect(payloads(options.evidence).at(-1)).toMatchObject({ succeeded: false, exitCode: 1 });
  });

  it("fails setup when deferred work changes source files", async () => {
    const options = await settings();
    const { commands } = scripted(async (argv) => {
      if (argv[1] === "rebuild") await writeFile(join(workspace, "package.json"), "{}\n");
      return ok();
    });
    const observed = await installFromLockfile({ ...options, commands, probeNetwork: refused });
    expect(observed.succeeded).toBe(false);
    expect(observed.detail).toContain("changed source files");
  });

  it("keeps the pnpm it fetched for the install and names its directory for the checks' PATH", async () => {
    await rm(join(workspace, "package-lock.json"));
    await writeFile(join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "fixture", packageManager: "pnpm@9.15.0" }),
    );
    const options = await settings();
    const bin = join(workspace, "node_modules", ".swarm-pnpm", "node_modules", ".bin");
    const { calls, commands } = scripted(async (argv) => {
      if (argv[0] === "pnpm") return { ...ok(), exitCode: 127, unavailable: "pnpm: not found" };
      if (argv.includes("--prefix")) {
        await mkdir(bin, { recursive: true });
        await writeFile(join(bin, "pnpm"), "");
      }
      return ok();
    });
    const observed = await installFromLockfile({ ...options, commands, probeNetwork: refused });
    expect(observed.succeeded).toBe(true);
    expect(observed.command).toBe(
      "npx --yes --package pnpm@9.15.0 pnpm install --frozen-lockfile --ignore-scripts",
    );
    expect(observed.toolDirectories).toEqual([bin]);
    expect(observed.detail).toContain("pnpm@9.15.0 kept at node_modules/.swarm-pnpm");
    const kept = calls.find((call) => call.argv.includes("--prefix"));
    expect(kept?.argv).toEqual([
      "npm",
      "install",
      "--prefix",
      "node_modules/.swarm-pnpm",
      "--no-save",
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "pnpm@9.15.0",
    ]);
    expect(kept?.options.network).toBe("registry");
    expect(payloads(options.evidence).slice(2)).toMatchObject([
      { phase: "intent", stage: "package-manager", network: "registry", toolDirectory: bin },
      { phase: "completed", succeeded: true },
    ]);
  });

  it("names no directory when pnpm could not be kept, so nothing absent is put on PATH", async () => {
    await rm(join(workspace, "package-lock.json"));
    await writeFile(join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "fixture", packageManager: "pnpm@9.15.0" }),
    );
    const options = await settings();
    const { commands } = scripted((argv) =>
      argv[0] === "pnpm"
        ? { ...ok(), exitCode: 127, unavailable: "pnpm: not found" }
        : argv.includes("--prefix")
          ? { ...ok(), exitCode: 1, stderr: "ETIMEDOUT" }
          : ok(),
    );
    const observed = await installFromLockfile({ ...options, commands, probeNetwork: refused });
    expect(observed.succeeded).toBe(true);
    expect(observed.toolDirectories).toBeUndefined();
    expect(observed.detail).toContain("a script that calls pnpm finds none");
  });

  it("installs a uv project itself offline: wheels fetched without running, the backend run offline", async () => {
    await rm(join(workspace, "package-lock.json"));
    await writeFile(
      join(workspace, "uv.lock"),
      'version = 1\n\n[[package]]\nname = "tinypkg"\nversion = "0.1.0"\nsource = { editable = "." }\n',
    );
    await writeFile(
      join(workspace, "pyproject.toml"),
      '[project]\nname = "tinypkg"\n\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n',
    );
    await mkdir(join(workspace, ".venv"));
    await writeFile(join(workspace, ".venv", ".gitignore"), "*\n");
    await writeFile(join(workspace, ".venv", "pyvenv.cfg"), "version_info = 3.12.12\n");
    const options = await settings();
    const { calls, commands } = scripted((argv) =>
      argv.includes("requires")
        ? ok('["editables~=0.3"]')
        : argv.includes("build")
          ? ok("tinypkg-0.1.0-py3-none-any.whl")
          : ok(),
    );
    const observed = await installFromLockfile({ ...options, commands, probeNetwork: refused });
    expect(observed.succeeded).toBe(true);
    expect(observed.detail).toContain(
      "the project's own editable install built by hatchling.build and installed offline where the checks run (network measured off)",
    );
    const fetchArgv = (requirement: string) => [
      "uv",
      "pip",
      "install",
      "--system",
      "--target",
      ".venv/.swarm-build/project/backend",
      "--only-binary",
      ":all:",
      "--python-version",
      "3.12",
      "--",
      requirement,
    ];
    expect(calls.map((call) => [call.argv.slice(0, 3).join(" "), call.options.network])).toEqual([
      ["uv sync --locked", "registry"],
      ["uv pip install", "registry"],
      [".venv/bin/python -I -S", undefined],
      ["uv pip install", "registry"],
      [".venv/bin/python -I -S", undefined],
      ["uv pip install", undefined],
    ]);
    expect(calls[1]?.argv).toEqual(fetchArgv("hatchling"));
    expect(calls[3]?.argv).toEqual(fetchArgv("editables~=0.3"));
    expect(calls[5]?.argv).toEqual([
      "uv",
      "pip",
      "install",
      "--offline",
      "--no-deps",
      "--python",
      ".venv/bin/python",
      ".venv/.swarm-build/project/wheel/tinypkg-0.1.0-py3-none-any.whl",
    ]);
    const stages = payloads(options.evidence)
      .filter((payload) => (payload as { phase: string }).phase === "intent")
      .map((payload) => [
        (payload as { stage?: string }).stage,
        (payload as { network: string }).network,
      ]);
    expect(stages).toEqual([
      [undefined, "registry"],
      ["build-requirements", "registry"],
      ["offline-lifecycle", "none"],
      ["build-requirements", "registry"],
      ["offline-lifecycle", "none"],
      ["offline-lifecycle", "none"],
    ]);
    await expect(access(join(workspace, ".venv", ".swarm-build"))).rejects.toThrow();
  });

  it("stops a uv project's install where the backend names a requirement that is not a registry release", async () => {
    await rm(join(workspace, "package-lock.json"));
    await writeFile(
      join(workspace, "uv.lock"),
      'version = 1\n\n[[package]]\nname = "tinypkg"\nversion = "0.1.0"\nsource = { editable = "." }\n',
    );
    await writeFile(
      join(workspace, "pyproject.toml"),
      '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n',
    );
    await mkdir(join(workspace, ".venv"));
    await writeFile(join(workspace, ".venv", ".gitignore"), "*\n");
    await writeFile(join(workspace, ".venv", "pyvenv.cfg"), "version_info = 3.12.12\n");
    const options = await settings();
    const { calls, commands } = scripted((argv) =>
      argv.includes("requires") ? ok('["evil @ https://example.invalid/evil.whl"]') : ok(),
    );
    const observed = await installFromLockfile({ ...options, commands, probeNetwork: refused });
    expect(observed.succeeded).toBe(true);
    expect(observed.detail).toContain("not plain registry requirements");
    expect(calls).toHaveLength(3);
  });

  describe("uv packages that installing would build", () => {
    const archiveBytes = "the source archive's bytes";
    const archiveHash = `sha256:${createHash("sha256").update(archiveBytes).digest("hex")}`;
    beforeEach(async () => {
      await rm(join(workspace, "package-lock.json"));
      await writeFile(
        join(workspace, "uv.lock"),
        [
          "version = 1",
          "",
          "[[package]]",
          'name = "app"',
          'version = "0.1.0"',
          'source = { virtual = "." }',
          "",
          "[[package]]",
          'name = "netsdist"',
          'version = "1.0.0"',
          'source = { registry = "https://pypi.example/simple" }',
          `sdist = { url = "https://files.example/netsdist-1.0.0.tar.gz", hash = "${archiveHash}" }`,
          "",
          "[[package]]",
          'name = "member"',
          'version = "0.1.0"',
          'source = { editable = "member" }',
          "",
          "[[package]]",
          'name = "fromgit"',
          'version = "1.0.0"',
          'source = { git = "https://example.invalid/fromgit?rev=abc#abc" }',
          "",
          "[[package]]",
          'name = "wheeled"',
          'version = "2.0.0"',
          'source = { registry = "https://pypi.example/simple" }',
          'sdist = { url = "https://files.example/wheeled-2.0.0.tar.gz", hash = "sha256:00" }',
          'wheels = [{ url = "https://files.example/wheeled-2.0.0-py3-none-any.whl", hash = "sha256:11" }]',
          "",
        ].join("\n"),
      );
      await mkdir(join(workspace, "member"));
      await writeFile(
        join(workspace, "member", "pyproject.toml"),
        '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n',
      );
      await mkdir(join(workspace, ".venv"));
      await writeFile(join(workspace, ".venv", ".gitignore"), "*\n");
      await writeFile(join(workspace, ".venv", "pyvenv.cfg"), "version_info = 3.12.12\n");
    });

    /** Answers as the image's interpreter, uv and the backends would, writing what they write. */
    const toolchain = (archive: string) => async (argv: readonly string[]) => {
      if (argv[4] === archiveFetchScript) {
        await mkdir(join(workspace, argv[6] as string, ".."), { recursive: true });
        await writeFile(join(workspace, argv[6] as string), archive);
      }
      if (argv[4] === archiveExtractScript) {
        const tree = join(workspace, argv[6] as string, "netsdist-1.0.0");
        await mkdir(tree, { recursive: true });
        await writeFile(
          join(tree, "pyproject.toml"),
          '[build-system]\nrequires = ["setuptools>=61"]\nbuild-backend = "setuptools.build_meta"\n',
        );
      }
      if (argv.includes("requires")) return ok("[]");
      if (argv.includes("build"))
        return ok(
          argv.includes("editable")
            ? "member-0.1.0-py3-none-any.whl"
            : "netsdist-1.0.0-py3-none-any.whl",
        );
      return ok();
    };

    it("leaves every build out of the registry-reaching install and builds each offline, fetching only bytes", async () => {
      const options = await settings();
      const { calls, commands } = scripted(toolchain(archiveBytes));
      const observed = await installFromLockfile({ ...options, commands, probeNetwork: refused });
      expect(observed.succeeded, observed.detail).toBe(true);
      expect(calls[0]?.argv).toEqual([
        ...(lockfileInstallerArgv("uv.lock") ?? []),
        "--no-install-package",
        "netsdist",
        "--no-install-package",
        "member",
        "--no-install-package",
        "fromgit",
      ]);
      expect(observed.detail).toContain(
        "netsdist 1.0.0 (a source archive only) built by setuptools.build_meta and installed offline where the checks run (network measured off)",
      );
      expect(observed.detail).toContain(
        "workspace member member built by hatchling.build and installed offline where the checks run (network measured off)",
      );
      expect(observed.detail).toContain(
        "fromgit was left out of the install: it comes from a git source",
      );
      const fetch = calls.find((call) => call.argv[4] === archiveFetchScript);
      expect(fetch?.argv.slice(5)).toEqual([
        "https://files.example/netsdist-1.0.0.tar.gz",
        ".venv/.swarm-build/0/archive/netsdist-1.0.0.tar.gz",
        archiveHash,
      ]);
      expect(fetch?.argv.slice(0, 4)).toEqual(["python3", "-I", "-S", "-c"]);
      expect(fetch?.options.network).toBe("registry");
      const hooks = calls.filter((call) => call.argv.includes(pep517BuildScript));
      expect(hooks.map((call) => [call.argv[0], call.options.cwd, call.options.network])).toEqual([
        [
          "../../../../bin/python",
          join(workspace, ".venv/.swarm-build/0/source/netsdist-1.0.0"),
          undefined,
        ],
        [
          "../../../../bin/python",
          join(workspace, ".venv/.swarm-build/0/source/netsdist-1.0.0"),
          undefined,
        ],
        ["../.venv/bin/python", join(workspace, "member"), undefined],
        ["../.venv/bin/python", join(workspace, "member"), undefined],
      ]);
      const intents = payloads(options.evidence).filter(
        (payload) => (payload as { phase: string }).phase === "intent",
      ) as { stage?: string; network: string; directory?: string }[];
      expect(intents.map((payload) => [payload.stage, payload.network])).toEqual([
        [undefined, "registry"],
        ["source-archive", "registry"],
        ["offline-lifecycle", "none"],
        ["build-requirements", "registry"],
        ["offline-lifecycle", "none"],
        ["offline-lifecycle", "none"],
        ["offline-lifecycle", "none"],
        ["build-requirements", "registry"],
        ["offline-lifecycle", "none"],
        ["offline-lifecycle", "none"],
        ["offline-lifecycle", "none"],
      ]);
      expect(intents[4]?.directory).toBe(".venv/.swarm-build/0/source/netsdist-1.0.0");
      expect(intents[8]?.directory).toBe("member");
      // Nothing that executes a backend ever asked for the registry.
      for (const call of calls.filter((one) => one.argv.includes(pep517BuildScript)))
        expect(call.options.network).toBeUndefined();
    });

    it("builds nothing from an archive whose bytes are not the lockfile's", async () => {
      const options = await settings();
      const { calls, commands } = scripted(toolchain("other bytes"));
      const observed = await installFromLockfile({ ...options, commands, probeNetwork: refused });
      expect(observed.succeeded).toBe(true);
      expect(observed.detail).toContain(
        `netsdist 1.0.0 (a source archive only) did not complete: the fetched archive's digest`,
      );
      expect(observed.detail).toContain(`is not the lockfile's ${archiveHash}`);
      expect(calls.some((call) => call.argv[4] === archiveExtractScript)).toBe(false);
    });

    it("builds nothing where the checks' network is reachable, and still installs the rest without building", async () => {
      const options = await settings();
      const { calls, commands } = scripted(toolchain(archiveBytes));
      const observed = await installFromLockfile({
        ...options,
        commands,
        probeNetwork: async () => ({ contained: false, observed: "reached" }),
      });
      expect(observed.succeeded).toBe(true);
      expect(observed.detail).toContain(
        "netsdist 1.0.0 (a source archive only), workspace member member did not run: a check-time command here reaches the network",
      );
      expect(calls.map((call) => call.argv.slice(0, 2).join(" "))).toEqual(["uv sync"]);
      expect(calls[0]?.argv).toContain("--no-build");
    });
  });
});
