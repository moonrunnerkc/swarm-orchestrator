import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultChildHome, harnessChildEnvironment } from "./child-environment.ts";
import {
  ChildHomeInUse,
  ChildHomeNotOwned,
  collectChildHomes,
  currentChildHome,
  establishRunChildHome,
  releaseRunChildHome,
  UnusableChildHome,
  withRunChildHome,
} from "./child-home.ts";

/**
 * One private HOME per independent run, carried through every child the run spawns, never
 * shared with another run unless the caller names one. The ordinary product paths establish
 * it at their lifecycle boundary; what is held here is the allocation, ownership, resumption
 * and release that those paths rely on.
 */
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-child-homes-test-"));
});

afterEach(async () => {
  const held = currentChildHome();
  if (held !== null) releaseRunChildHome(held, { keep: true });
  await rm(root, { recursive: true, force: true });
});

const noOverride = { PATH: "/usr/bin" } as const;

describe("a private child home per run", () => {
  it("gives two runs different homes, owner-only, each carrying a marker naming its run", () => {
    const first = establishRunChildHome({ runId: "run-a", root, inherited: noOverride });
    releaseRunChildHome(first, { keep: true });
    const second = establishRunChildHome({ runId: "run-b", root, inherited: noOverride });

    expect(first.path).not.toBe(second.path);
    expect(first).toMatchObject({ mode: "private", origin: "created", runId: "run-a" });
    for (const home of [first, second]) {
      expect(statSync(home.path).mode & 0o777).toBe(0o700);
      const marker = JSON.parse(readFileSync(join(home.path, ".swarm-child-home.json"), "utf8"));
      expect(marker).toMatchObject({ schema: "swarm-child-home.v1", runId: home.runId });
    }
  });

  it("keeps a sentinel one run's children wrote out of the other run's home", () => {
    const first = establishRunChildHome({ runId: "run-a", root, inherited: noOverride });
    writeFileSync(join(first.path, "browsers-installed"), "x");
    releaseRunChildHome(first, { keep: true });

    const second = establishRunChildHome({ runId: "run-b", root, inherited: noOverride });
    expect(existsSync(join(second.path, "browsers-installed"))).toBe(false);
    expect(existsSync(join(first.path, "browsers-installed"))).toBe(true);
  });

  it("is what every child environment built after it carries as HOME", () => {
    const home = establishRunChildHome({ runId: "run-a", root, inherited: noOverride });
    expect(defaultChildHome(noOverride)).toBe(home.path);
    expect(harnessChildEnvironment().variables.HOME).toBe(home.path);
    // The same home on every call: a run's retries and its verification read one state.
    expect(harnessChildEnvironment().variables.HOME).toBe(home.path);
  });

  it("links only npm's content-addressed store, shared across runs, and nothing else", () => {
    const first = establishRunChildHome({ runId: "run-a", root, inherited: noOverride });
    releaseRunChildHome(first, { keep: true });
    const second = establishRunChildHome({ runId: "run-b", root, inherited: noOverride });
    const link = join(second.path, ".npm", "_cacache");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(first.npmCache).toBe(second.npmCache);
    // npm's other state under HOME (logs, config) is the run's own.
    expect(lstatSync(join(second.path, ".npm")).isSymbolicLink()).toBe(false);
  });
});

describe("release", () => {
  it("removes a private home at the end of its run, and keeps one asked to stay", () => {
    const removed = establishRunChildHome({ runId: "run-a", root, inherited: noOverride });
    releaseRunChildHome(removed, { keep: false });
    expect(existsSync(removed.path)).toBe(false);
    expect(currentChildHome()).toBeNull();

    const kept = establishRunChildHome({ runId: "run-b", root, inherited: noOverride });
    releaseRunChildHome(kept, { keep: true });
    expect(existsSync(kept.path)).toBe(true);
  });

  it("never removes another run's home, even when handed its path", () => {
    const other = establishRunChildHome({ runId: "run-a", root, inherited: noOverride });
    releaseRunChildHome(other, { keep: true });
    // A handle claiming a different run over the same directory.
    releaseRunChildHome({ ...other, runId: "run-z" }, { keep: false });
    expect(existsSync(other.path)).toBe(true);
  });

  it("keeps the home when the command throws, and removes it on a normal return by default", async () => {
    await expect(
      withRunChildHome({ runId: "run-a", root, inherited: noOverride }, async () => {
        throw new Error("the run failed");
      }),
    ).rejects.toThrow("the run failed");
    expect(existsSync(join(root, "run-a"))).toBe(true);

    await withRunChildHome({ runId: "run-b", root, inherited: noOverride }, async () => 0);
    expect(existsSync(join(root, "run-b"))).toBe(false);

    await withRunChildHome(
      { runId: "run-c", root, inherited: noOverride },
      async () => "resumable",
      (result) => result === "resumable",
    );
    expect(existsSync(join(root, "run-c"))).toBe(true);
  });
});

describe("resumption", () => {
  it("takes over the earlier run's home when its marker names that run and nobody holds it", () => {
    const original = establishRunChildHome({
      runId: "run-a",
      root,
      inherited: noOverride,
      pid: 11,
      now: 1000,
    });
    writeFileSync(join(original.path, "state"), "kept");
    releaseRunChildHome(original, { keep: true });

    const resumed = establishRunChildHome({
      runId: "run-a-continued",
      resumeOf: "run-a",
      root,
      inherited: noOverride,
      pid: 12,
      now: 2000,
      isAlive: () => false,
    });
    expect(resumed).toMatchObject({ path: original.path, origin: "resumed", runId: "run-a" });
    expect(readFileSync(join(resumed.path, "state"), "utf8")).toBe("kept");
    const marker = JSON.parse(readFileSync(join(resumed.path, ".swarm-child-home.json"), "utf8"));
    expect(marker).toMatchObject({ pid: 12, heldSince: 2000, createdAt: 1000 });
  });

  it("refuses a home another live process still holds", () => {
    const original = establishRunChildHome({
      runId: "run-a",
      root,
      inherited: noOverride,
      pid: 11,
    });
    releaseRunChildHome(original, { keep: true });
    expect(() =>
      establishRunChildHome({
        runId: "run-a-continued",
        resumeOf: "run-a",
        root,
        inherited: noOverride,
        pid: 12,
        isAlive: (pid) => pid === 11,
      }),
    ).toThrow(ChildHomeInUse);
  });

  it("refuses a directory that carries no marker or another run's marker", () => {
    mkdirSync(join(root, "run-a"), { recursive: true, mode: 0o700 });
    expect(() => establishRunChildHome({ runId: "run-a", root, inherited: noOverride })).toThrow(
      ChildHomeNotOwned,
    );

    const other = establishRunChildHome({ runId: "run-b", root, inherited: noOverride });
    releaseRunChildHome(other, { keep: true });
    expect(() =>
      establishRunChildHome({
        runId: "later",
        resumeOf: "run-a",
        root,
        inherited: noOverride,
        isAlive: () => false,
      }),
    ).toThrow(ChildHomeNotOwned);
    writeFileSync(
      join(root, "run-a", ".swarm-child-home.json"),
      JSON.stringify({
        schema: "swarm-child-home.v1",
        runId: "run-b",
        pid: 1,
        createdAt: 0,
        heldSince: 0,
      }),
    );
    expect(() =>
      establishRunChildHome({
        runId: "later",
        resumeOf: "run-a",
        root,
        inherited: noOverride,
        isAlive: () => false,
      }),
    ).toThrow(/names run run-b/);
  });

  it("recreates the home, and says so, where the earlier run's home is gone", () => {
    const resumed = establishRunChildHome({
      runId: "run-a-continued",
      resumeOf: "run-a",
      root,
      inherited: noOverride,
    });
    expect(resumed).toMatchObject({
      origin: "recreated",
      runId: "run-a",
      path: join(root, "run-a"),
    });
  });
});

describe("the explicit override", () => {
  it("uses the named directory as a caller-selected home and never removes it", () => {
    const named = join(root, "shared-by-choice");
    const home = establishRunChildHome({
      runId: "run-a",
      root,
      inherited: { SWARM_CHILD_HOME: named },
    });
    expect(home).toMatchObject({ path: named, mode: "explicit", origin: "named", npmCache: null });
    expect(defaultChildHome({ SWARM_CHILD_HOME: named })).toBe(named);
    releaseRunChildHome(home, { keep: false });
    expect(existsSync(named)).toBe(true);
  });

  it("refuses a relative path rather than falling back to a default", () => {
    expect(() =>
      establishRunChildHome({ runId: "run-a", root, inherited: { SWARM_CHILD_HOME: "relative" } }),
    ).toThrow(UnusableChildHome);
    expect(() => defaultChildHome({ SWARM_CHILD_HOME: "relative" })).toThrow(UnusableChildHome);
  });
});

describe("a process that established no run home", () => {
  it("gets a home private to the process rather than one shared by every run on the machine", () => {
    const held = currentChildHome();
    if (held !== null) releaseRunChildHome(held, { keep: true });
    const home = defaultChildHome(noOverride);
    expect(home).toBe(defaultChildHome(noOverride));
    expect(home).not.toContain("swarm-child-home/");
    expect(home).toContain(`process-${process.pid}-`);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });
});

describe("the orphan sweep", () => {
  it("names homes nobody holds that are older than the window, and removes only when asked", () => {
    const old = establishRunChildHome({
      runId: "run-old",
      root,
      inherited: noOverride,
      pid: 11,
      now: 1000,
    });
    releaseRunChildHome(old, { keep: true });
    const live = establishRunChildHome({
      runId: "run-live",
      root,
      inherited: noOverride,
      pid: 12,
      now: 1000,
    });
    releaseRunChildHome(live, { keep: true });
    const recent = establishRunChildHome({
      runId: "run-recent",
      root,
      inherited: noOverride,
      pid: 13,
      now: 9000,
    });
    releaseRunChildHome(recent, { keep: true });
    // A directory under the root with no marker is somebody else's, and is never touched.
    mkdirSync(join(root, "not-a-home"));

    const options = { root, olderThan: 5000, now: 10_000, isAlive: (pid: number) => pid === 12 };
    expect(collectChildHomes(options).map((home) => home.runId)).toEqual(["run-old"]);
    expect(existsSync(old.path)).toBe(true);

    collectChildHomes({ ...options, remove: true });
    expect(existsSync(old.path)).toBe(false);
    expect(existsSync(live.path)).toBe(true);
    expect(existsSync(recent.path)).toBe(true);
    expect(existsSync(join(root, "not-a-home"))).toBe(true);
  });
});
