import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildLaunch,
  frozenSwarmFlags,
  inferenceBegan,
  launchEnvironment,
  resolveFrozenInput,
  sandboxProfile,
  treeDigest,
  validateLaunch,
} from "./launch-config.mjs";

const digestOf = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const darwin = process.platform === "darwin";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "launch-config-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A stand-in executable that prints a version, as `opencode --version` does. */
function fakeExecutable(directory, name, version) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\necho ${version}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** A launch's directories as the runner makes them: scratch, a git workspace, a fresh home. */
function launchDirectories(name = "launch-a") {
  const scratch = join(root, "work", name);
  const workspace = join(scratch, "workspace");
  const home = join(scratch, "home");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(home, ".npm"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: workspace });
  return { scratch, workspace, home };
}

function manifestWith(pins, extra = {}) {
  return {
    pins: {
      model: "qwen3.6:35b-a3b",
      endpoint: "http://127.0.0.1:11434/v1",
      nodeBin: process.execPath,
      node: process.version,
      swarmCli: join(root, "swarm", "cli.js"),
      swarmCliDigest: digestOf("cli"),
      swarmBuildDigest: "sha256:unbuilt",
      ...pins,
    },
    isolation: { protectedRoots: [join(root, "sealed"), join(root, "work")] },
    arms: { swarm: { flags: ["--adaptive"] }, "swarm-direct": { flags: ["--attempts", "0"] } },
    ...extra,
  };
}

const task = { id: "neutral-smoke", workType: "bugfix" };

describe("pinned executables (the 2026-10-22 slot 6 failure)", () => {
  it("runs the pinned OpenCode by absolute path, whatever another opencode on PATH says", () => {
    const pinned = fakeExecutable(join(root, "pinned"), "opencode", "1.19.4");
    fakeExecutable(join(root, "shadow"), "opencode", "1.14.48");
    const directories = launchDirectories();
    const manifest = manifestWith({ opencodeBin: pinned, opencode: "1.19.4" });
    const previous = process.env.PATH;
    process.env.PATH = `${join(root, "shadow")}:${previous}`;
    try {
      const launch = buildLaunch({
        manifest,
        arm: "opencode",
        task,
        prompt: "p",
        base: "HEAD",
        ...directories,
        remainingMs: 60_000,
        tokenAllowance: 1,
      });
      expect(launch.inner[0]).toBe(pinned);
      expect(launch.env.PATH).not.toContain(join(root, "shadow"));
      const version = validateLaunch({
        manifest,
        arm: "opencode",
        launch,
        canary: join(root, "sealed", "x"),
        otherLaunch: join(root, "work", "b"),
      }).checks.find((one) => one.name === "opencode version");
      expect(version).toMatchObject({ ok: true });
    } finally {
      process.env.PATH = previous;
    }
  });

  it("refuses before inference a bare name, and a pinned file that is the wrong version", () => {
    const directories = launchDirectories();
    const bare = manifestWith({ opencodeBin: "opencode", opencode: "1.19.4" });
    const launch = buildLaunch({
      manifest: bare,
      arm: "opencode",
      task,
      prompt: "p",
      base: "HEAD",
      ...directories,
      remainingMs: 60_000,
      tokenAllowance: 1,
    });
    const refused = validateLaunch({
      manifest: bare,
      arm: "opencode",
      launch,
      canary: join(root, "sealed", "x"),
      otherLaunch: join(root, "work", "b"),
    });
    expect(refused.ok).toBe(false);
    expect(
      refused.checks.find((one) => one.name === "opencode is an absolute pinned file"),
    ).toMatchObject({ ok: false });

    const wrong = manifestWith({
      opencodeBin: fakeExecutable(join(root, "old"), "opencode", "1.14.48"),
      opencode: "1.19.4",
    });
    const second = buildLaunch({
      manifest: wrong,
      arm: "opencode",
      task,
      prompt: "p",
      base: "HEAD",
      ...directories,
      remainingMs: 60_000,
      tokenAllowance: 1,
    });
    const version = validateLaunch({
      manifest: wrong,
      arm: "opencode",
      launch: second,
      canary: join(root, "sealed", "x"),
      otherLaunch: join(root, "work", "b"),
    }).checks.find((one) => one.name === "opencode version");
    expect(version).toMatchObject({ ok: false, detail: "1.14.48; pinned 1.19.4" });
  });
});

describe("frozen inputs (the 2026-10-22 slot 2 failure)", () => {
  it("finds an input by its bytes under a registered root, never by a path computed elsewhere", () => {
    const right = join(root, "archive", "payloads", "patches");
    const wrong = join(root, "session", "patches");
    mkdirSync(right, { recursive: true });
    mkdirSync(wrong, { recursive: true });
    writeFileSync(join(right, "alias.patch"), "the retained candidate\n");
    // A file of the same name with other bytes is not the input.
    writeFileSync(join(wrong, "alias.patch"), "something else\n");
    const input = { name: "alias.patch", digest: digestOf("the retained candidate\n") };
    expect(resolveFrozenInput({ inputRoots: [wrong, right] }, input)?.path).toBe(
      join(right, "alias.patch"),
    );
    expect(resolveFrozenInput({ inputRoots: [wrong] }, input)).toBeNull();

    const directories = launchDirectories();
    const manifest = manifestWith({}, { inputRoots: [wrong] });
    const launch = buildLaunch({
      manifest,
      arm: "swarm",
      task,
      prompt: "p",
      base: "HEAD",
      contractPath: join(root, "c.json"),
      ...directories,
      remainingMs: 60_000,
      tokenAllowance: 1,
    });
    const result = validateLaunch({
      manifest,
      arm: "swarm",
      launch,
      inputs: [input],
      canary: join(root, "sealed", "x"),
      otherLaunch: join(root, "work", "b"),
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((one) => one.name === "frozen input alias.patch")).toMatchObject({
      ok: false,
    });
  });
});

describe("the pinned build", () => {
  it("changes digest when any built file changes, not only the entry", () => {
    const dist = join(root, "dist");
    mkdirSync(join(dist, "gates"), { recursive: true });
    writeFileSync(join(dist, "cli.js"), "entry\n");
    writeFileSync(join(dist, "gates", "agent.js"), "one\n");
    const before = treeDigest(dist);
    writeFileSync(join(dist, "gates", "agent.js"), "two\n");
    expect(treeDigest(dist)).not.toBe(before);
  });
});

describe("the launch environment and arm flags", () => {
  it("is built from named entries and carries nothing else from the experimenter's shell", () => {
    process.env.LAUNCH_CONFIG_TEST_SECRET = "do-not-pass";
    try {
      const env = launchEnvironment({
        manifest: manifestWith({}),
        home: "/h",
        scratch: "/s",
        workspace: "/w",
        arm: "swarm",
      });
      expect(Object.values(env)).not.toContain("do-not-pass");
      expect(env).toMatchObject({
        HOME: "/h",
        SWARM_CHILD_HOME: "/h",
        TMPDIR: "/s/tmp",
        PWD: "/w",
      });
      expect(env.PATH.split(":")[0]).toBe(join(process.execPath, ".."));
    } finally {
      delete process.env.LAUNCH_CONFIG_TEST_SECRET;
    }
  });

  it("freezes only named Swarm flags, so the ablation and the revised arm differ by declared flags", () => {
    expect(frozenSwarmFlags(["--adaptive"])).toEqual(["--adaptive"]);
    expect(frozenSwarmFlags(["--attempts", "0"])).toEqual(["--attempts", "0"]);
    expect(() => frozenSwarmFlags(["--max-steps", "80"])).toThrow(/not a flag/);
    expect(() => frozenSwarmFlags(["--attempts", "9"])).toThrow(/takes/);
  });

  it("reads whether inference began from the events the arm printed", () => {
    const call = JSON.stringify({
      schema: "swarm.event.v1",
      event: { type: "model-call", step: 1 },
    });
    expect(inferenceBegan("swarm", `noise\n${call}\n`)).toBe(true);
    expect(inferenceBegan("swarm-direct", "refused before dispatch\n")).toBe(false);
    expect(inferenceBegan("opencode", `${JSON.stringify({ type: "step_start" })}\n`)).toBe(true);
    expect(inferenceBegan("opencode", "")).toBe(false);
  });
});

describe.runIf(darwin)("access from inside the launch's own profile", () => {
  it("denies the protected canary and other launches and admits the launch's own directory", () => {
    mkdirSync(join(root, "sealed"), { recursive: true });
    writeFileSync(join(root, "sealed", "hidden-check.mjs"), "secret\n");
    const other = launchDirectories("launch-b");
    writeFileSync(join(other.workspace, "solution.js"), "theirs\n");
    const directories = launchDirectories("launch-a");
    const manifest = manifestWith({
      opencodeBin: fakeExecutable(join(root, "pinned"), "opencode", "1.19.4"),
      opencode: "1.19.4",
    });
    const launch = buildLaunch({
      manifest,
      arm: "opencode",
      task,
      prompt: "p",
      base: "HEAD",
      ...directories,
      remainingMs: 60_000,
      tokenAllowance: 1,
    });
    const result = validateLaunch({
      manifest,
      arm: "opencode",
      launch,
      canary: join(root, "sealed", "hidden-check.mjs"),
      otherLaunch: other.workspace,
    });
    expect(
      result.checks
        .filter((one) => one.name.startsWith("inside the profile"))
        .map((one) => [one.name, one.ok]),
    ).toEqual([
      ["inside the profile: a protected canary is unreadable", true],
      ["inside the profile: another launch's directory is unlistable", true],
      ["inside the profile: the workspace is listable", true],
      ["inside the profile: the workspace is writable", true],
      ["inside the profile: the launch's temporary directory is writable", true],
    ]);
    expect(result.ok).toBe(true);
  });

  it("fails validation when the profile does not actually protect the canary", () => {
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    writeFileSync(join(root, "elsewhere", "hidden-check.mjs"), "secret\n");
    const directories = launchDirectories();
    const manifest = manifestWith({
      opencodeBin: fakeExecutable(join(root, "pinned"), "opencode", "1.19.4"),
      opencode: "1.19.4",
    });
    const launch = buildLaunch({
      manifest,
      arm: "opencode",
      task,
      prompt: "p",
      base: "HEAD",
      ...directories,
      remainingMs: 60_000,
      tokenAllowance: 1,
    });
    const result = validateLaunch({
      manifest,
      arm: "opencode",
      launch,
      canary: join(root, "elsewhere", "hidden-check.mjs"),
      otherLaunch: join(root, "work", "b"),
    });
    expect(result.ok).toBe(false);
    expect(
      result.checks.find(
        (one) => one.name === "inside the profile: a protected canary is unreadable",
      ),
    ).toMatchObject({ ok: false });
  });

  it("reads a frozen tool inside a denied parent, never writes it, and keeps its documentation denied", () => {
    const tools = join(root, "tools");
    mkdirSync(join(tools, "frozen", "docs"), { recursive: true });
    mkdirSync(join(tools, "older-clone"), { recursive: true });
    writeFileSync(join(tools, "frozen", "cli.js"), "run\n");
    writeFileSync(join(tools, "frozen", "docs", "hidden-check.mjs"), "secret\n");
    writeFileSync(join(tools, "older-clone", "evidence.md"), "old\n");
    const profile = sandboxProfile({
      protectedRoots: [tools],
      readableRoots: [join(tools, "frozen")],
      reprotectedRoots: [join(tools, "frozen", "docs")],
      ownRoots: [],
    });
    const status = (command) =>
      spawnSync(
        "/usr/bin/sandbox-exec",
        ["-p", profile, "/bin/sh", "-c", `${command} >/dev/null 2>&1; echo $?`],
        { encoding: "utf8" },
      ).stdout.trim();
    expect(status(`cat ${join(tools, "frozen", "cli.js")}`)).toBe("0");
    expect(status(`echo x > ${join(tools, "frozen", "new.js")}`)).not.toBe("0");
    expect(status(`cat ${join(tools, "frozen", "docs", "hidden-check.mjs")}`)).not.toBe("0");
    expect(status(`cat ${join(tools, "older-clone", "evidence.md")}`)).not.toBe("0");
  });

  it("writes the same profile text for every arm of a manifest", () => {
    const directories = launchDirectories();
    const manifest = manifestWith({ opencodeBin: "/x/opencode", opencode: "1.19.4" });
    const profiles = ["swarm", "swarm-direct", "opencode"].map(
      (arm) =>
        buildLaunch({
          manifest,
          arm,
          task,
          prompt: "p",
          base: "HEAD",
          contractPath: "/c",
          ...directories,
          remainingMs: 60_000,
          tokenAllowance: 1,
        }).profile,
    );
    expect(new Set(profiles).size).toBe(1);
    expect(sandboxProfile({ protectedRoots: ["/a"], ownRoots: [] })).not.toContain(
      "allow file-read-data",
    );
  });
});
