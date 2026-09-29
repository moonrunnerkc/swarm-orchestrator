import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * Three projects the verifier could not measure while install scripts stayed off, each held by
 * a real `ci --install` run in the network-disabled container, with a control that a genuinely
 * broken change still fails there:
 *
 * - an npm project on better-sqlite3, whose native binding only its install script builds;
 * - a uv project in src layout, whose tests import the package and call its console script,
 *   which `uv sync --no-install-project` never installed;
 * - a pnpm workspace whose scripts call pnpm, which the install fetched for itself alone.
 *
 * The npm fixture also carries a dependency whose install script tries the network: it runs in
 * the deferred phase, is refused, and the run says so. The registry is needed to lock and fetch
 * the fixtures, as the existing container install test already needs it.
 */
function dockerAnswers(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

const docker = dockerAnswers();
const uvImage = "ghcr.io/astral-sh/uv:python3.12-bookworm";
let scratch = "";

interface CiReport {
  regression: string;
  executionTrust: string;
  install: {
    succeeded: boolean;
    command: string;
    detail: string;
    toolDirectories?: string[];
  } | null;
  checks: { id: string; status: string; detail: string }[];
  bundleDirectory: string;
  checkoutPath: string | null;
}

async function repository(name: string): Promise<{
  path: string;
  git: (args: readonly string[]) => Promise<string>;
}> {
  const path = join(scratch, name);
  await mkdir(path, { recursive: true });
  const git = async (args: readonly string[]) =>
    (
      await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
        cwd: path,
      })
    ).stdout.trim();
  await git(["init", "-q", "-b", "main"]);
  return { path, git };
}

/** Commits the working tree and returns its commit. */
async function commit(git: (args: readonly string[]) => Promise<string>, message: string) {
  await git(["add", "-A"]);
  await git(["commit", "-qm", message]);
  return git(["rev-parse", "HEAD"]);
}

async function ci(
  workspace: string,
  head: string,
  base: string,
  isolation: string | null,
): Promise<{ report: CiReport; output: string }> {
  const ran = await run(
    process.execPath,
    [
      resolve("src/swarm-verify.ts"),
      "ci",
      "--workspace",
      workspace,
      "--branch",
      head,
      "--base",
      base,
      ...(isolation === null ? [] : ["--isolation", isolation, "--require-isolation"]),
      "--install",
      "--json",
    ],
    {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1" },
      timeout: 900_000,
      maxBuffer: 64_000_000,
    },
  ).catch((cause: { stdout?: string; stderr?: string }) => ({
    stdout: cause.stdout ?? "",
    stderr: cause.stderr ?? "",
  }));
  const line =
    ran.stdout
      .trim()
      .split("\n")
      .findLast((one) => one.startsWith("{")) ?? "{}";
  return { report: JSON.parse(line) as CiReport, output: `${ran.stdout}\n${ran.stderr}` };
}

/** Every dependency-install payload the run recorded, in ledger order. */
async function setupRecords(bundleDirectory: string): Promise<Record<string, unknown>[]> {
  const ledger = await readFile(join(bundleDirectory, "ledger.jsonl"), "utf8");
  const records = ledger
    .split("\n")
    .filter((line) => line.includes('"dependency-install"'))
    .map((line) => JSON.parse(line) as { payloadDigest: string });
  return Promise.all(
    records.map(async (record) =>
      JSON.parse(
        await readFile(
          join(bundleDirectory, "blobs", `${record.payloadDigest.replace("sha256:", "")}.json`),
          "utf8",
        ),
      ),
    ),
  );
}

beforeAll(async () => {
  if (!docker) return;
  // Under the repository rather than the system temp directory: Docker Desktop shares the
  // former with containers and not the latter.
  await mkdir(resolve(".swarm"), { recursive: true });
  scratch = await mkdtemp(join(resolve(".swarm"), "deferred-setup-"));
});

afterAll(async () => {
  if (scratch.length > 0) await rm(scratch, { recursive: true, force: true });
});

describe.skipIf(!docker)("an npm dependency whose install script builds its native binding", () => {
  let workspace = "";
  let base = "";
  let head = "";
  let broken = "";
  beforeAll(async () => {
    const probeSource = join(scratch, "netprobe-src");
    await mkdir(probeSource, { recursive: true });
    await writeFile(
      join(probeSource, "package.json"),
      '{ "name": "netprobe", "version": "1.0.0", "scripts": { "install": "node probe.js" } }\n',
    );
    await writeFile(
      join(probeSource, "probe.js"),
      [
        'const request = require("node:https").get("https://registry.npmjs.org/", (response) => {',
        '  console.log("install script reached the network: " + response.statusCode);',
        "  process.exit(0);",
        "});",
        'request.on("error", (error) => {',
        '  console.error("install script network attempt refused: " + error.code);',
        "  process.exit(1);",
        "});",
        'request.setTimeout(5000, () => request.destroy(new Error("timeout")));',
        "",
      ].join("\n"),
    );
    const repo = await repository("npm-native");
    workspace = repo.path;
    await run("npm", ["pack", "--pack-destination", workspace], { cwd: probeSource });
    await writeFile(
      join(workspace, "package.json"),
      `${JSON.stringify({
        name: "native",
        version: "1.0.0",
        type: "module",
        scripts: { test: "node --test" },
        dependencies: { "better-sqlite3": "12.4.1", netprobe: "file:netprobe-1.0.0.tgz" },
      })}\n`,
    );
    await writeFile(join(workspace, ".gitignore"), "node_modules\n");
    await writeFile(
      join(workspace, "sum.mjs"),
      'import Database from "better-sqlite3";\nexport const sum = (a, b) => new Database(":memory:").prepare("select ? + ? as x").get(a, b).x;\n',
    );
    await writeFile(
      join(workspace, "sum.test.mjs"),
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "./sum.mjs";\ntest("sums in sqlite", () => assert.equal(sum(2, 3), 5));\n',
    );
    await run(
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: workspace },
    );
    base = await commit(repo.git, "base");
    await writeFile(
      join(workspace, "sum.mjs"),
      'import Database from "better-sqlite3";\nconst database = new Database(":memory:");\nexport const sum = (a, b) => database.prepare("select ? + ? as x").get(a, b).x;\n',
    );
    head = await commit(repo.git, "reuse one database");
    await repo.git(["checkout", "-q", "-b", "broken", base]);
    await writeFile(
      join(workspace, "sum.mjs"),
      'import Database from "better-sqlite3";\nexport const sum = (a, b) => new Database(":memory:").prepare("select ? + ? + 1 as x").get(a, b).x;\n',
    );
    broken = await commit(repo.git, "off by one");
  }, 300_000);

  it("builds the binding offline where the checks run, so the tests measure the change", async () => {
    const { report, output } = await ci(workspace, head, base, "docker:node:24-bookworm");
    expect(report.install?.succeeded, output).toBe(true);
    expect(report.executionTrust).toBe("isolated");
    expect(report.regression, output).toBe("pass");
    expect(report.checks.find((check) => check.id === "tests")?.status).toBe("passed");
    // The dependency that tries the network ran in the same deferred phase and was refused.
    expect(report.install?.detail).toContain(
      "install scripts of 2 dependencies (better-sqlite3, netprobe) ran offline where the checks run (network measured off) and failed (exit 1)",
    );
    expect(report.install?.detail).toContain("install script network attempt refused");
    expect(report.install?.detail).not.toContain("install script reached the network");
    const offline = (await setupRecords(report.bundleDirectory)).filter(
      (payload) => payload.stage === "offline-lifecycle",
    );
    expect(offline).toMatchObject([
      {
        phase: "intent",
        network: "none",
        networkProbe: { contained: true },
        argv: [
          "npm",
          "rebuild",
          "--foreground-scripts",
          "--nodedir=/usr/local",
          "better-sqlite3",
          "netprobe",
        ],
      },
      { phase: "completed", succeeded: false, exitCode: 1 },
    ]);
  }, 900_000);

  it("still fails a change that genuinely breaks the code", async () => {
    const { report, output } = await ci(workspace, broken, base, "docker:node:24-bookworm");
    expect(report.install?.succeeded, output).toBe(true);
    expect(report.regression, output).toBe("fail");
    expect(report.checks.find((check) => check.id === "tests")?.status).toBe("failed");
  }, 900_000);

  it("never runs the deferred scripts on the host, where a check-time command reaches the network", async () => {
    const { report, output } = await ci(workspace, head, base, null);
    expect(report.install?.succeeded, output).toBe(true);
    expect(report.install?.detail).toContain(
      "install scripts of 2 dependencies (better-sqlite3, netprobe) did not run",
    );
    expect(report.install?.detail).toContain(
      "registry-served code is never run with network access",
    );
    expect(
      (await setupRecords(report.bundleDirectory)).some(
        (payload) => payload.stage === "offline-lifecycle",
      ),
    ).toBe(false);
  }, 900_000);
});

describe.skipIf(!docker)("a uv project in src layout with a console script", () => {
  let workspace = "";
  let base = "";
  let head = "";
  let broken = "";
  beforeAll(async () => {
    const repo = await repository("uv-src");
    workspace = repo.path;
    await mkdir(join(workspace, "src", "tinypkg"), { recursive: true });
    await mkdir(join(workspace, "tests"));
    await writeFile(
      join(workspace, "pyproject.toml"),
      [
        "[project]",
        'name = "tinypkg"',
        'version = "0.1.0"',
        'requires-python = ">=3.11"',
        "dependencies = []",
        "",
        "[project.scripts]",
        'tinypkg = "tinypkg.cli:main"',
        "",
        "[dependency-groups]",
        'dev = ["pytest>=8"]',
        "",
        "[build-system]",
        'requires = ["hatchling"]',
        'build-backend = "hatchling.build"',
        "",
      ].join("\n"),
    );
    await writeFile(join(workspace, ".gitignore"), ".venv/\n__pycache__/\n.pytest_cache/\n");
    await writeFile(
      join(workspace, "src", "tinypkg", "__init__.py"),
      "def double(n):\n    return n * 2\n",
    );
    await writeFile(
      join(workspace, "src", "tinypkg", "cli.py"),
      "import sys\nfrom tinypkg import double\n\n\ndef main():\n    print(double(int(sys.argv[1])))\n",
    );
    await writeFile(
      join(workspace, "tests", "test_tiny.py"),
      [
        "import subprocess",
        "from tinypkg import double",
        "",
        "",
        "def test_double():",
        "    assert double(2) == 4",
        "",
        "",
        "def test_console_script():",
        '    ran = subprocess.run(["tinypkg", "3"], capture_output=True, text=True, check=True)',
        '    assert ran.stdout.strip() == "6"',
        "",
      ].join("\n"),
    );
    await run(
      "docker",
      [
        "run",
        "--rm",
        "--volume",
        `${workspace}:/w`,
        "--workdir",
        "/w",
        "--user",
        `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        "--env",
        "HOME=/tmp",
        uvImage,
        "uv",
        "lock",
      ],
      { timeout: 300_000 },
    );
    base = await commit(repo.git, "base");
    await writeFile(
      join(workspace, "src", "tinypkg", "__init__.py"),
      "def double(n):\n    return n + n\n",
    );
    head = await commit(repo.git, "add instead of multiply");
    await repo.git(["checkout", "-q", "-b", "broken", base]);
    await writeFile(
      join(workspace, "src", "tinypkg", "__init__.py"),
      "def double(n):\n    return n * 3\n",
    );
    broken = await commit(repo.git, "triple");
  }, 600_000);

  it("installs the project itself offline, so tests import it and find its console script", async () => {
    const { report, output } = await ci(workspace, head, base, `docker:${uvImage}`);
    expect(report.install?.succeeded, output).toBe(true);
    expect(report.executionTrust).toBe("isolated");
    expect(report.install?.detail).toContain(
      "the project's own editable install built by hatchling.build and installed offline where the checks run (network measured off)",
    );
    expect(report.regression, output).toBe("pass");
    expect(report.checks.find((check) => check.id === "tests")?.status).toBe("passed");
    const stages = (await setupRecords(report.bundleDirectory))
      .filter((payload) => payload.phase === "intent")
      .map((payload) => [payload.stage ?? "install", payload.network]);
    expect(stages).toEqual([
      ["install", "registry"],
      ["build-requirements", "registry"],
      ["offline-lifecycle", "none"],
      ["build-requirements", "registry"],
      ["offline-lifecycle", "none"],
      ["offline-lifecycle", "none"],
    ]);
  }, 900_000);

  it("still fails a change that genuinely breaks the code", async () => {
    const { report, output } = await ci(workspace, broken, base, `docker:${uvImage}`);
    expect(report.install?.succeeded, output).toBe(true);
    expect(report.regression, output).toBe("fail");
    expect(report.checks.find((check) => check.id === "tests")?.status).toBe("failed");
  }, 900_000);
});

describe.skipIf(!docker)("a pnpm workspace whose scripts call pnpm", () => {
  let workspace = "";
  let base = "";
  let head = "";
  let broken = "";
  beforeAll(async () => {
    const repo = await repository("pnpm-scripts");
    workspace = repo.path;
    await mkdir(join(workspace, "packages", "a"), { recursive: true });
    await mkdir(join(workspace, "packages", "b"), { recursive: true });
    await writeFile(
      join(workspace, "package.json"),
      `${JSON.stringify({
        name: "ws",
        version: "1.0.0",
        private: true,
        packageManager: "pnpm@9.15.0",
        scripts: { typecheck: "pnpm -r run typecheck", test: "pnpm -r run test" },
      })}\n`,
    );
    await writeFile(join(workspace, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    for (const name of ["a", "b"])
      await writeFile(
        join(workspace, "packages", name, "package.json"),
        `${JSON.stringify({
          name,
          version: "1.0.0",
          scripts: { typecheck: "node check.mjs", test: "node --test" },
        })}\n`,
      );
    await writeFile(join(workspace, "packages", "a", "check.mjs"), "process.exit(0);\n");
    await writeFile(join(workspace, "packages", "b", "check.mjs"), "process.exit(0);\n");
    await writeFile(
      join(workspace, "packages", "b", "b.test.mjs"),
      'import test from "node:test";\ntest("b", () => {});\n',
    );
    await writeFile(
      join(workspace, "packages", "a", "a.test.mjs"),
      'import test from "node:test";\ntest("a", () => {});\n',
    );
    await writeFile(join(workspace, ".gitignore"), "node_modules\n");
    await run(
      "npx",
      [
        "--yes",
        "--package",
        "pnpm@9.15.0",
        "pnpm",
        "install",
        "--lockfile-only",
        "--ignore-scripts",
      ],
      { cwd: workspace },
    );
    base = await commit(repo.git, "base");
    await writeFile(
      join(workspace, "packages", "b", "check.mjs"),
      "// every declared type is checked\nprocess.exit(0);\n",
    );
    head = await commit(repo.git, "note the check");
    await repo.git(["checkout", "-q", "-b", "broken", base]);
    await writeFile(join(workspace, "packages", "b", "check.mjs"), "process.exit(1);\n");
    broken = await commit(repo.git, "break the check");
  }, 300_000);

  it("keeps the pnpm that installed on the checks' PATH, so a script calling pnpm is measured", async () => {
    const { report, output } = await ci(workspace, head, base, "docker:node:24-bookworm");
    expect(report.install?.succeeded, output).toBe(true);
    expect(report.install?.toolDirectories).toEqual([
      expect.stringMatching(/node_modules\/\.swarm-pnpm\/node_modules\/\.bin$/),
    ]);
    const typecheck = report.checks.find((check) => check.id === "typecheck");
    expect(typecheck?.status, output).toBe("passed");
    expect(report.regression, output).toBe("pass");
    expect(
      (await setupRecords(report.bundleDirectory)).find(
        (payload) => payload.stage === "package-manager" && payload.phase === "intent",
      ),
    ).toMatchObject({ network: "registry", argv: expect.arrayContaining(["pnpm@9.15.0"]) });
  }, 900_000);

  it("still fails a change that genuinely breaks a script run through pnpm", async () => {
    const { report, output } = await ci(workspace, broken, base, "docker:node:24-bookworm");
    expect(report.install?.succeeded, output).toBe(true);
    expect(report.checks.find((check) => check.id === "typecheck")?.status, output).toBe("failed");
    expect(report.regression, output).toBe("fail");
  }, 900_000);
});

/** The host's own non-loopback address, which a container on the bridge network can reach. */
const hostAddress = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;

/**
 * Packages uv would build: the real source-only docopt 0.6.2, a workspace member, and netsdist,
 * a source archive served by a local index whose setup.py tries the network. Before this, the
 * registry-reaching `uv sync --no-install-project` ran netsdist's setup.py and the member's
 * build with the network on (measured: netsdist's attempt got through). Now nothing is built
 * there; docopt and the member are built offline and the tests that import them are measured,
 * and netsdist's attempt is refused and reported.
 */
describe.skipIf(!docker || hostAddress === undefined)(
  "a uv project whose dependencies installing would build",
  () => {
    let workspace = "";
    let base = "";
    let head = "";
    let broken = "";
    let server: Server | null = null;
    beforeAll(async () => {
      const index = join(scratch, "index");
      const tree = join(scratch, "netsdist-src", "netsdist-1.0.0");
      await mkdir(join(tree, "netsdist"), { recursive: true });
      await writeFile(
        join(tree, "setup.py"),
        [
          "import socket, sys",
          "from setuptools import setup",
          "try:",
          '    socket.create_connection(("pypi.org", 443), timeout=5).close()',
          "except OSError as error:",
          '    sys.exit("netsdist setup.py: network attempt refused: %s" % error)',
          'with open("/workspace/NETSDIST_REACHED_THE_NETWORK", "w") as marker:',
          '    marker.write("netsdist setup.py ran with the network on\\n")',
          "setup()",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(tree, "pyproject.toml"),
        '[project]\nname = "netsdist"\nversion = "1.0.0"\n\n[build-system]\nrequires = ["setuptools>=61"]\nbuild-backend = "setuptools.build_meta"\n',
      );
      await writeFile(
        join(tree, "PKG-INFO"),
        "Metadata-Version: 2.2\nName: netsdist\nVersion: 1.0.0\n",
      );
      await writeFile(join(tree, "netsdist", "__init__.py"), "VALUE = 1\n");
      await mkdir(join(index, "netsdist"), { recursive: true });
      const archive = join(index, "netsdist", "netsdist-1.0.0.tar.gz");
      await run("tar", ["-czf", archive, "-C", join(scratch, "netsdist-src"), "netsdist-1.0.0"]);
      const digest = createHash("sha256")
        .update(await readFile(archive))
        .digest("hex");
      await writeFile(
        join(index, "netsdist", "index.html"),
        `<html><body><a href="netsdist-1.0.0.tar.gz#sha256=${digest}">netsdist-1.0.0.tar.gz</a></body></html>\n`,
      );
      server = createServer(async (request, response) => {
        const path = (request.url ?? "/").replace(/^\/simple\//, "").replace(/\/$/, "/index.html");
        try {
          const body = await readFile(join(index, path));
          response.setHeader(
            "Content-Type",
            path.endsWith(".html") ? "text/html" : "application/octet-stream",
          );
          response.end(body);
        } catch {
          response.statusCode = 404;
          response.end();
        }
      });
      await new Promise<void>((ready) => server?.listen(0, hostAddress, ready));
      const port = (server.address() as AddressInfo).port;

      const repo = await repository("uv-builds");
      workspace = repo.path;
      await mkdir(join(workspace, "src", "app"), { recursive: true });
      await mkdir(join(workspace, "member", "src", "member"), { recursive: true });
      await mkdir(join(workspace, "tests"));
      await writeFile(
        join(workspace, "pyproject.toml"),
        [
          "[project]",
          'name = "app"',
          'version = "0.1.0"',
          'requires-python = ">=3.11"',
          'dependencies = ["docopt==0.6.2", "member", "netsdist==1.0.0"]',
          "",
          "[dependency-groups]",
          'dev = ["pytest>=8"]',
          "",
          "[tool.uv.workspace]",
          'members = ["member"]',
          "",
          "[tool.uv.sources]",
          "member = { workspace = true }",
          'netsdist = { index = "local" }',
          "",
          "[[tool.uv.index]]",
          'name = "local"',
          `url = "http://${hostAddress}:${port}/simple"`,
          "explicit = true",
          "",
          "[build-system]",
          'requires = ["hatchling"]',
          'build-backend = "hatchling.build"',
          "",
        ].join("\n"),
      );
      await writeFile(
        join(workspace, "member", "pyproject.toml"),
        '[project]\nname = "member"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n',
      );
      await writeFile(join(workspace, "member", "src", "member", "__init__.py"), "OFFSET = 1\n");
      await writeFile(
        join(workspace, ".gitignore"),
        ".venv/\n__pycache__/\n.pytest_cache/\n*.egg-info/\n",
      );
      await writeFile(
        join(workspace, "src", "app", "__init__.py"),
        "from docopt import docopt\nfrom member import OFFSET\n\n\ndef parse(argv):\n    return int(docopt('usage: app <n>', argv)['<n>']) + OFFSET\n",
      );
      await writeFile(
        join(workspace, "tests", "test_app.py"),
        "from app import parse\n\n\ndef test_parse():\n    assert parse(['41']) == 42\n",
      );
      await run(
        "docker",
        [
          "run",
          "--rm",
          "--volume",
          `${workspace}:/w`,
          "--workdir",
          "/w",
          "--user",
          `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
          "--env",
          "HOME=/tmp",
          uvImage,
          "uv",
          "lock",
        ],
        { timeout: 300_000 },
      );
      // Locking reads netsdist's static metadata; if it had run setup.py with the network on, the
      // marker says so and the fixture is not what this test claims.
      await expect(
        readFile(join(workspace, "NETSDIST_REACHED_THE_NETWORK"), "utf8"),
      ).rejects.toThrow();
      base = await commit(repo.git, "base");
      await writeFile(
        join(workspace, "src", "app", "__init__.py"),
        "from docopt import docopt\nfrom member import OFFSET\n\n\ndef parse(argv):\n    arguments = docopt('usage: app <n>', argv)\n    return int(arguments['<n>']) + OFFSET\n",
      );
      head = await commit(repo.git, "name the parsed arguments");
      await repo.git(["checkout", "-q", "-b", "broken", base]);
      await writeFile(
        join(workspace, "src", "app", "__init__.py"),
        "from docopt import docopt\nfrom member import OFFSET\n\n\ndef parse(argv):\n    return int(docopt('usage: app <n>', argv)['<n>']) - OFFSET\n",
      );
      broken = await commit(repo.git, "subtract instead");
    }, 600_000);

    afterAll(async () => {
      await new Promise<void>((closed) =>
        server === null ? closed() : server.close(() => closed()),
      );
    });

    it("builds nothing where the registry is reachable, and builds offline what the tests import", async () => {
      const { report, output } = await ci(workspace, head, base, `docker:${uvImage}`);
      expect(report.install?.succeeded, output).toBe(true);
      expect(report.install?.command).toContain("--no-build");
      expect(report.install?.detail).toContain(
        "docopt 0.6.2 (a source archive only) built by setuptools.build_meta:__legacy__ and installed offline where the checks run (network measured off)",
      );
      expect(report.install?.detail).toContain(
        "workspace member member built by hatchling.build and installed offline",
      );
      expect(report.install?.detail).toContain(
        "the project's own editable install built by hatchling.build and installed offline",
      );
      // The archive whose setup.py tries the network: refused, reported, and never reached.
      expect(report.install?.detail).toContain(
        "netsdist 1.0.0 (a source archive only) did not complete",
      );
      expect(report.install?.detail).toContain("netsdist setup.py: network attempt refused");
      await expect(
        readFile(join(report.checkoutPath ?? "", "NETSDIST_REACHED_THE_NETWORK"), "utf8"),
      ).rejects.toThrow();
      expect(report.regression, output).toBe("pass");
      expect(report.checks.find((check) => check.id === "tests")?.status).toBe("passed");
      const records = await setupRecords(report.bundleDirectory);
      const intents = records.filter((payload) => payload.phase === "intent");
      expect(intents[0]).toMatchObject({
        network: "registry",
        argv: expect.arrayContaining(["--no-build", "--no-install-package", "docopt"]),
      });
      expect(intents.filter((payload) => payload.stage === "source-archive")).toHaveLength(2);
      // Every command that runs a build backend or setup.py ran with the network off.
      for (const payload of intents.filter((one) =>
        (one.argv as string[]).some((argument) => argument.includes("build_")),
      ))
        expect(payload).toMatchObject({ network: "none", networkProbe: { contained: true } });
    }, 900_000);

    it("still fails a change that genuinely breaks the code", async () => {
      const { report, output } = await ci(workspace, broken, base, `docker:${uvImage}`);
      expect(report.install?.succeeded, output).toBe(true);
      expect(report.regression, output).toBe("fail");
      expect(report.checks.find((check) => check.id === "tests")?.status).toBe("failed");
    }, 900_000);
  },
);
