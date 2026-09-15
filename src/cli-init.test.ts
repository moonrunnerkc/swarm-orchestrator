import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { establishNodeHarness } from "./cli-init.ts";

const run = promisify(execFile);

let workspace = "";

async function git(...args: readonly string[]): Promise<string> {
  const { stdout } = await run(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { cwd: workspace },
  );
  return stdout.trim();
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-node-harness-"));
  await run("git", ["init", "-q", workspace]);
  await git("commit", "-q", "--allow-empty", "-m", "empty");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("establishing a Node harness in an empty repository", () => {
  it("writes the manifest and the ignore file and commits them, so the base carries them", async () => {
    const before = await git("rev-parse", "HEAD");

    const established = await establishNodeHarness(workspace);

    const after = await git("rev-parse", "HEAD");
    expect(established.commit).toBe(after);
    expect(after).not.toBe(before);
    expect(await git("status", "--porcelain")).toBe("");
    expect(JSON.parse(await readFile(join(workspace, "package.json"), "utf8"))).toMatchObject({
      scripts: { test: "node --test" },
    });
    expect(await git("show", "--stat", "--format=%s", "HEAD")).toContain("package.json");
  });
});
