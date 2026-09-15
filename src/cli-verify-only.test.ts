import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commandDefinitions } from "./cli-command-definitions.ts";

const run = promisify(execFile);

/**
 * The commands a reader can run with nothing configured: no provider key, no local backend.
 * Which commands those are is command definition data, and this holds the data to the build by
 * running each one for real under an environment holding no key, with the local endpoint pinned
 * to a port nothing listens on, so a command that quietly probed for a model would fail here
 * rather than pass on a machine that happens to serve one.
 */
const committedBundle = resolve("docs/evidence/2026-08-18/live-frontier");
const committedSigner = "sha256:db270183c40c65843cacd2b3dcf20ee249d146d98c56699b2f3512ebeb84a52a";

const modelFree = commandDefinitions.filter((command) => command.model === "none");

let scratch = "";
let workspace = "";
let patch = "";

async function git(args: readonly string[]): Promise<void> {
  await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: workspace,
  });
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-verify-only-"));
  workspace = join(scratch, "workspace");
  await run("git", ["init", "-q", workspace]);
  await writeFile(
    join(workspace, "package.json"),
    '{ "name": "w", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  );
  await writeFile(join(workspace, "double.mjs"), "export const double = (n) => n + n;\n");
  await writeFile(
    join(workspace, "double.test.mjs"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { double } from "./double.mjs";',
      'test("doubles", () => assert.equal(double(2), 4));',
      "",
    ].join("\n"),
  );
  await git(["add", "-A"]);
  await git(["commit", "-qm", "base"]);
  await writeFile(join(workspace, "double.mjs"), "export const double = (n) => n * 2;\n");
  const diff = await run("git", ["diff"], { cwd: workspace });
  patch = join(scratch, "candidate.diff");
  await writeFile(patch, diff.stdout);
  await git(["checkout", "--", "double.mjs"]);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** The CLI, under an environment that names no key and a local endpoint nothing answers on. */
async function swarm(args: readonly string[]): Promise<{ code: number; stdout: string }> {
  const environment = {
    PATH: process.env.PATH ?? "",
    HOME: join(scratch, "home"),
    NO_COLOR: "1",
    SWARM_LOCAL_BASE_URL: "http://127.0.0.1:9",
  };
  try {
    const ran = await run(process.execPath, [resolve("src/cli.ts"), ...args], {
      env: environment,
      timeout: 60_000,
      maxBuffer: 8_000_000,
    });
    return { code: 0, stdout: ran.stdout };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

/** A real invocation per model-free command, so the datum is held to a run and not to a word. */
const invocations: Readonly<
  Record<string, () => Promise<{ readonly code: number; readonly stdout: string }>>
> = {
  verify: () => swarm(["verify", committedBundle, "--signer", committedSigner]),
  ci: () => swarm(["ci", "--patch", patch, "--workspace", workspace]),
  gates: () => swarm(["gates", "--workspace", workspace]),
};

describe("the commands declared to need no model", () => {
  it("are the three the verify-only page walks through", () => {
    expect(modelFree.map((command) => command.name).sort()).toEqual(["ci", "gates", "verify"]);
  });

  it("are each held to a real run here, so the datum cannot be added without one", () => {
    for (const command of modelFree) {
      expect(invocations).toHaveProperty(command.name);
    }
  });

  it("are each documented on the verify-only page", async () => {
    const page = await readFile(resolve("docs/verify-only.md"), "utf8");
    for (const command of modelFree) {
      expect(page).toContain(`swarm ${command.name}`);
    }
  });

  it("verify checks a committed bundle and its signer with nothing configured", async () => {
    const ran = await invocations.verify?.();

    expect(ran?.stdout).toContain("integrity:  valid");
    expect(ran?.stdout).toContain("signer:     trusted");
    expect(ran?.code).toBe(0);
  });

  it("ci measures a patch in a fresh checkout with nothing configured", async () => {
    const ran = await invocations.ci?.();

    expect(ran?.stdout).toContain("regression: pass");
    expect(ran?.stdout).toContain("task: unjudged");
    // Not verified, because no oracle was given: that is the honest exit, not a model failure.
    expect(ran?.code).toBe(1);
    expect(ran?.stdout).not.toMatch(/model|API key|endpoint/i);
  });

  it("gates measures a workspace with nothing configured", async () => {
    const ran = await invocations.gates?.();

    expect(ran?.stdout).toContain("tests: 1 collected, 1 passed");
    expect(ran?.stdout).toContain("acceptable: yes");
    expect(ran?.code).toBe(0);
  });
});
