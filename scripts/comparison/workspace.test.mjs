import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { commandLog } from "../campaign/exec.mjs";
import {
  browserCacheIn,
  npmToolchain,
  packageManagerToolchain,
  parsePackageManager,
  prepareLaunchHome,
  sharedNpmCache,
  snapshotPatch,
  swarmConfigurationText,
  writeArmConfiguration,
} from "./workspace.mjs";

function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "comparison-workspace-"));
  mkdirSync(join(directory, ".git/info"), { recursive: true });
  writeFileSync(join(directory, ".git/info/exclude"), "");
  return directory;
}

describe("what each arm is configured with", () => {
  it("writes a declared advisory gate with the product's own command, and refuses any other declaration", () => {
    const task = {
      id: "t-task",
      projectTest: ["npm", "test"],
    };
    const lint = { command: "npm run --loglevel=error lint", severity: "advisory" };
    const written = parseToml(swarmConfigurationText("http://e/v1", task, { lint }));
    expect(written.gates).toEqual({ lint, tests: { command: "npm test" } });
    for (const declared of [
      { tests: { command: "npm test", severity: "advisory" } },
      { lint: { ...lint, severity: "blocking" } },
      { lint: { ...lint, command: "true" } },
    ])
      expect(() => swarmConfigurationText("http://e/v1", task, declared)).toThrow(
        /not an advisory/,
      );
  });

  it("gives opencode the pinned endpoint and model for every call, with Swarm's output cap and thinking off", () => {
    const directory = workspace();
    writeArmConfiguration(directory, "opencode", "http://127.0.0.1:8000/v1", "qwen3.8:27b");
    const written = JSON.parse(readFileSync(join(directory, "opencode.json"), "utf8"));
    expect(written.model).toBe("rapidmlx/qwen3.8:27b");
    expect(written.small_model).toBe("rapidmlx/qwen3.8:27b");
    expect(written.provider.rapidmlx.options.baseURL).toBe("http://127.0.0.1:8000/v1");
    expect(written.provider.rapidmlx.models["qwen3.8:27b"]).toEqual({
      name: "qwen3.8:27b",
      tool_call: true,
      limit: { context: 131072, output: 8192 },
      options: {
        enable_thinking: false,
        chat_template_kwargs: { enable_thinking: false },
        reasoningEffort: "none",
        top_p: 0.95,
      },
    });
    expect(written.permission).toEqual({ edit: "allow", bash: "allow", webfetch: "deny" });
    expect(readFileSync(join(directory, ".git/info/exclude"), "utf8")).toContain("opencode.json");
  });

  it("gives swarm the same endpoint with thinking off, and the task's test command as its tests gate", () => {
    const directory = workspace();
    const task = { id: "t", projectTest: ["npm", "run", "test-node"] };
    writeArmConfiguration(directory, "swarm", "http://127.0.0.1:8000/v1", "qwen3.8:27b", task);
    const text = readFileSync(join(directory, "swarm.toml"), "utf8");
    expect(text).toBe(
      '[providers]\nlocal_endpoint = "http://127.0.0.1:8000/v1"\nlocal_thinking = false\n\n[gates.tests]\ncommand = "npm run test-node"\n',
    );
    // What was written is what the product's own parser reads back.
    expect(parseToml(text)).toEqual({
      providers: { local_endpoint: "http://127.0.0.1:8000/v1", local_thinking: false },
      gates: { tests: { command: "npm run test-node" } },
    });
    expect(readFileSync(join(directory, ".git/info/exclude"), "utf8")).toContain("swarm.toml");
  });

  it("refuses to serialize a test command whose words a shell could read otherwise", () => {
    expect(() =>
      swarmConfigurationText("http://127.0.0.1:8000/v1", {
        id: "t",
        projectTest: ["sh", "-c", "npm test 2>/dev/null"],
      }),
    ).toThrow(/plain words/);
  });
});

describe("the mutable state a launch gets", () => {
  it("creates a fresh home with npm's store linked to the shared content-addressed cache", () => {
    const home = join(mkdtempSync(join(tmpdir(), "comparison-home-")), "child-home");
    const prepared = prepareLaunchHome(home);
    expect(prepared.home).toBe(home);
    expect(existsSync(home)).toBe(true);
    expect(lstatSync(join(home, ".npm/_cacache")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, ".npm/_cacache"))).toBe(join(sharedNpmCache, "_cacache"));
    expect(prepared.npmCache).toContain("content-addressed");
    expect(browserCacheIn(home)).toBe(false);
    // A home that is already there is not fresh, whatever is in it.
    expect(() => prepareLaunchHome(home)).toThrow(/must be fresh/);
  });

  it("recognizes a downloaded browser cache in a home", () => {
    const home = mkdtempSync(join(tmpdir(), "comparison-home-"));
    mkdirSync(join(home, "Library/Caches/ms-playwright"), { recursive: true });
    expect(browserCacheIn(home)).toBe(true);
  });
});

describe("the package manager a base declares", () => {
  it("reads npm and pnpm releases, and nothing else", () => {
    expect(parsePackageManager("npm@11.2.0")).toEqual({ name: "npm", version: "11.2.0" });
    expect(parsePackageManager("pnpm@10.34.5+sha512.abc")).toEqual({
      name: "pnpm",
      version: "10.34.5",
    });
    expect(parsePackageManager("yarn@4.1.0")).toBeNull();
    expect(parsePackageManager(undefined)).toBeNull();
  });

  it("keeps npm under the comparison's tools and puts any other manager outside the protected roots", () => {
    expect(packageManagerToolchain("npm", "11.2.0")).toBe(npmToolchain("11.2.0"));
    expect(packageManagerToolchain("pnpm", "10.34.5")).toBe(
      join(homedir(), ".cache", "swarm-capability-tools", "pnpm-10.34.5"),
    );
  });
});

describe("the harness's snapshot of a candidate", () => {
  it("reads the change, untracked files included, through its own index and leaves the arm's alone", async () => {
    const directory = mkdtempSync(join(tmpdir(), "comparison-snapshot-"));
    const git = (...args) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: directory,
        encoding: "utf8",
      });
    git("init", "-q");
    writeFileSync(join(directory, "a.js"), "export const tokens = [];\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD").trim();
    writeFileSync(join(directory, "a.js"), "export const tokens = state.tokens;\n");
    writeFileSync(join(directory, "b.js"), "new\n");
    writeFileSync(join(directory, ".aider.chat.history.md"), "mine\n");
    git("add", "a.js");
    const staged = git("diff", "--cached", "--name-only");
    const log = commandLog(join(directory, ".blobs"));
    const patch = await snapshotPatch(
      log,
      directory,
      base,
      join(tmpdir(), `snapshot-${process.pid}.index`),
    );
    expect(patch).toContain("export const tokens = state.tokens;");
    expect(patch).toContain("b/b.js");
    expect(patch).not.toContain("aider");
    expect(git("diff", "--cached", "--name-only")).toBe(staged);
  });
});
