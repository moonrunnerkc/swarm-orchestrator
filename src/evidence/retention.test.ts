import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectSessions, describeCollection, olderThanMs } from "./retention.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-retention-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A session directory with a ledger, so what is collected looks like what a run leaves. */
async function makeSession(id: string, ageMs: number) {
  const directory = join(root, id);
  await mkdir(join(directory, "blobs"), { recursive: true });
  await writeFile(join(directory, "ledger.jsonl"), '{"sequence":0}\n');
  await writeFile(join(directory, "blobs", "sha256-aa"), "payload");
  const when = new Date(Date.now() - ageMs);
  // Both times, because a reader deciding age from one that a copy resets is deciding from
  // when the file was moved rather than when the run happened.
  const { utimes } = await import("node:fs/promises");
  await utimes(directory, when, when);
  return directory;
}

const day = 24 * 60 * 60 * 1000;

describe("what a garbage collection would remove", () => {
  it("names the sessions older than the cutoff and leaves the rest alone", async () => {
    await makeSession("old-one", 40 * day);
    await makeSession("recent-one", 2 * day);

    const collection = await collectSessions({
      root,
      olderThan: olderThanMs("30d"),
      now: Date.now(),
    });

    expect(collection.sessions.map((one) => one.sessionId)).toEqual(["old-one"]);
  });

  it("reports what it would free, so the number is known before anything is deleted", async () => {
    await makeSession("old-one", 40 * day);

    const collection = await collectSessions({
      root,
      olderThan: olderThanMs("30d"),
      now: Date.now(),
    });

    expect(collection.bytes).toBeGreaterThan(0);
    expect(describeCollection(collection, false)).toMatch(/would remove/i);
  });

  it("removes nothing unless it is asked to, because deletion of evidence is not a default", async () => {
    const directory = await makeSession("old-one", 40 * day);

    await collectSessions({ root, olderThan: olderThanMs("30d"), now: Date.now() });

    expect((await stat(directory)).isDirectory()).toBe(true);
  });

  it("removes exactly what it named when it is asked to", async () => {
    await makeSession("old-one", 40 * day);
    await makeSession("recent-one", 2 * day);

    const collection = await collectSessions({
      root,
      olderThan: olderThanMs("30d"),
      now: Date.now(),
      remove: true,
    });

    expect(collection.removed).toBe(true);
    expect((await readdir(root)).sort()).toEqual(["recent-one"]);
  });

  it("reads a retention window a person would type", () => {
    expect(olderThanMs("30d")).toBe(30 * day);
    expect(olderThanMs("12h")).toBe(12 * 60 * 60 * 1000);
    expect(olderThanMs("90m")).toBe(90 * 60 * 1000);
  });

  it("refuses a window it cannot read, rather than picking one", () => {
    expect(() => olderThanMs("soon")).toThrow(/30d|12h|90m/);
    expect(() => olderThanMs("")).toThrow();
  });

  it("leaves a directory that is not a session alone, whatever its age", async () => {
    await mkdir(join(root, "not-a-session"), { recursive: true });
    const when = new Date(Date.now() - 40 * day);
    const { utimes } = await import("node:fs/promises");
    await utimes(join(root, "not-a-session"), when, when);

    const collection = await collectSessions({
      root,
      olderThan: olderThanMs("30d"),
      now: Date.now(),
      remove: true,
    });

    expect(collection.sessions).toHaveLength(0);
    expect(await readdir(root)).toContain("not-a-session");
  });
});

describe("reporting a store that holds hundreds of sessions", () => {
  it("names a few and counts the rest, because the list is the whole line otherwise", async () => {
    for (let index = 0; index < 20; index += 1) {
      await makeSession(`old-${String(index).padStart(2, "0")}`, 40 * day);
    }

    const collection = await collectSessions({
      root,
      olderThan: olderThanMs("30d"),
      now: Date.now(),
    });
    const described = describeCollection(collection, false);

    expect(described).toContain("and 12 more");
    expect(described.split(",").length).toBeLessThan(12);
  });
});
