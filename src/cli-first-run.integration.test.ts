import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * What a first run off a terminal exits with when it cannot start, through the real command line.
 * A remote install walk ran the task in a repository with no manifest and got exit 1, the code
 * for work that ran and was not acceptable, where nothing had run.
 */
let scratch = "";
let root = "";

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-first-run-"));
  // The run's HOME sits beside the repository, never in it, or its own files are the change.
  root = join(scratch, "repo");
  await mkdir(root);
  await run("git", ["init", "-q"], { cwd: root });
  await run(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "start",
    ],
    { cwd: root },
  );
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function swarm(...args: string[]): Promise<{ code: number; output: string }> {
  return run(process.execPath, [resolve("src/cli.ts"), ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", HOME: join(scratch, "home"), NO_COLOR: "1" },
    timeout: 60_000,
  }).then(
    (ran) => ({ code: 0, output: `${ran.stdout}${ran.stderr}` }),
    (failed: { code?: number; stdout?: string; stderr?: string }) => ({
      code: failed.code ?? -1,
      output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`,
    }),
  );
}

const unreachable = [
  "--model",
  "local:qwen3.6:35b-a3b",
  "--local-endpoint",
  "http://127.0.0.1:9/v1",
  "--no-tui",
];

it("reports a repository with no manifest as unavailable, exit 4, before any model is asked", async () => {
  const ran = await swarm("make a change", ...unreachable);
  expect(ran.output).toContain("no manifest in");
  expect(ran.code).toBe(4);
}, 60_000);

it("reports a pinned model the endpoint never answers as unverified, exit 4", async () => {
  await writeFile(
    join(root, "package.json"),
    '{ "type": "module", "scripts": { "test": "node --test" } }\n',
  );
  await run("git", ["add", "package.json"], { cwd: root });
  await run(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "manifest"],
    { cwd: root },
  );
  const ran = await swarm("make a change", ...unreachable);
  expect(ran.output).toContain("outcome: unverified");
  expect(ran.code).toBe(4);
}, 120_000);
