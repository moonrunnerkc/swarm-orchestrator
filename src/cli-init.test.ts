import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { establishNodeHarness, offerApprovalMode } from "./cli-init.ts";

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
  await git("config", "user.email", "harness@example.com");
  await git("config", "user.name", "harness");
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

describe("a repository whose git has no identity to commit with", () => {
  /** Found on a CI runner: the files were written and the commit failed with git's own advice. */
  it("names the remedy and leaves the written files for the person to commit", async () => {
    await git("config", "--unset", "user.email");
    await git("config", "--unset", "user.name");
    const environment = {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const withoutIdentity = { ...environment, GIT_AUTHOR_NAME: "", GIT_COMMITTER_NAME: "" };

    await expect(establishNodeHarness(workspace, withoutIdentity)).rejects.toThrow(
      /git config user\.name/,
    );
    expect(await readFile(join(workspace, "package.json"), "utf8")).toContain("node --test");
  });
});

/**
 * Asked once per workspace and written down, so the second run does not ask again. Off a
 * terminal nothing can be asked, nothing is written, and the default of asking stands.
 */
describe("offering the approval mode once per workspace", () => {
  function deps(files: Record<string, string>, isTty: boolean, answer: string) {
    const asked: string[] = [];
    const written = new Map<string, string>();
    return {
      asked,
      written,
      deps: {
        workspace: "/work/repo",
        isTty,
        ask: (question: string) => {
          asked.push(question);
          return Promise.resolve(answer);
        },
        readFile: (path: string) => Promise.resolve(files[path] ?? null),
        writeFile: (path: string, text: string) => {
          written.set(path, text);
          return Promise.resolve();
        },
      },
    };
  }

  it("writes auto into a workspace that had no swarm.toml when the person says yes", async () => {
    const { deps: d, written, asked } = deps({}, true, "y");

    await offerApprovalMode(d);

    expect(asked).toHaveLength(1);
    expect(written.get("/work/repo/swarm.toml")).toBe('[tools]\napproval = "auto"\n');
  });

  it("appends ask to an existing file when the person says anything else", async () => {
    const { deps: d, written } = deps(
      { "/work/repo/swarm.toml": '[gates]\ntests = "npm test"\n' },
      true,
      "",
    );

    await offerApprovalMode(d);

    expect(written.get("/work/repo/swarm.toml")).toBe(
      '[gates]\ntests = "npm test"\n\n[tools]\napproval = "ask"\n',
    );
  });

  it("asks nothing and writes nothing where the file already answers", async () => {
    const {
      deps: d,
      written,
      asked,
    } = deps({ "/work/repo/swarm.toml": '[tools]\napproval = "auto"\n' }, true, "y");

    await offerApprovalMode(d);

    expect(asked).toEqual([]);
    expect(written.size).toBe(0);
  });

  it("asks nothing off a terminal, so the default of asking stands", async () => {
    const { deps: d, written, asked } = deps({}, false, "y");

    await offerApprovalMode(d);

    expect(asked).toEqual([]);
    expect(written.size).toBe(0);
  });
});
