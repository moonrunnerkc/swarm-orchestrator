import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { hostname, tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordOutcome } from "./outcomes.ts";
import { modelRecord, profilePath } from "./profile.ts";

const machine = {
  hostname: hostname(),
  platform: process.platform,
  arch: process.arch,
  totalMemory: totalmem(),
};
const v1 = (outcomes: Record<string, unknown>, at = machine) =>
  `${JSON.stringify({ version: 1, machine: at, probes: {}, outcomes }, null, 2)}\n`;
const gemma = {
  complete: 12,
  other: 2,
  kinds: { fix: { complete: 9, other: 1 }, feature: { complete: 3, other: 1 } },
};

/** A swarm home whose default profile holds the given bytes, and what the record logged. */
async function homeWith(bytes: string) {
  const home = await mkdtemp(join(tmpdir(), "profile-"));
  const path = profilePath(home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  const logged: string[] = [];
  const log = (line: string) => logged.push(line);
  return { home, path, logged, log, files: async () => (await readdir(dirname(path))).sort() };
}

describe("a version 1 profile", () => {
  it("reads as version 2 with its counts unchanged and marked as predating attribution", async () => {
    const { home, path, files } = await homeWith(v1({ gemma }));
    const profile = await modelRecord(home).read();
    expect(profile.version).toBe(2);
    expect(profile.outcomes.gemma).toEqual({ ...gemma, legacyOther: 2, unattributed: 0 });
    // Reading migrates in memory alone.
    expect(await readFile(path, "utf8")).toBe(v1({ gemma }));
    expect(await files()).toEqual([`${hostname()}.json`]);
  });

  it("is kept beside the version 2 file the first write puts in its place, and only once", async () => {
    const old = v1({ gemma });
    const { home, path, logged, log, files } = await homeWith(old);
    const record = modelRecord(home, { log });
    await recordOutcome(record, "gemma", "unattributed", "fix");
    const backup = path.replace(/\.json$/, ".v1.json");
    expect(await readFile(backup, "utf8")).toBe(old);
    expect(logged).toEqual([
      `the model record at ${path} was version 1: its counts are carried forward, and the file as it was is kept at ${backup}`,
    ]);
    const written = JSON.parse(await readFile(path, "utf8"));
    expect(written.version).toBe(2);
    expect(written.outcomes.gemma).toMatchObject({
      complete: 12,
      other: 2,
      legacyOther: 2,
      unattributed: 1,
    });
    await recordOutcome(record, "gemma", "model", "fix");
    await recordOutcome(record, "gemma", "complete", "fix");
    // New marks against the model are not legacy ones.
    expect(JSON.parse(await readFile(path, "utf8")).outcomes.gemma).toMatchObject({
      complete: 13,
      other: 3,
      legacyOther: 2,
      unattributed: 1,
    });
    expect(await files()).toEqual([`${hostname()}.json`, `${hostname()}.v1.json`]);
    expect(logged).toHaveLength(1);
  });

  it("never overwrites a backup: a different version 1 file met later is kept under its own name", async () => {
    const { home, path, files } = await homeWith(v1({ gemma }));
    const backup = path.replace(/\.json$/, ".v1.json");
    await writeFile(backup, "an earlier backup\n");
    await recordOutcome(modelRecord(home), "gemma", "complete");
    expect(await readFile(backup, "utf8")).toBe("an earlier backup\n");
    const dated = (await files()).filter((name) => /\.v1-\d{8}T\d+Z\.json$/.test(name));
    expect(dated).toHaveLength(1);
    expect(await readFile(join(dirname(path), dated[0] ?? ""), "utf8")).toBe(v1({ gemma }));
  });
});

describe("a profile that cannot be used", () => {
  it("is read as empty where it does not parse, said so, and kept aside before it is replaced", async () => {
    const bytes = '{"version": 1, "outcomes": {"gemma": {"complete": 12, "oth';
    const { home, path, logged, log, files } = await homeWith(bytes);
    const record = modelRecord(home, { log });
    expect((await record.read()).outcomes).toEqual({});
    await record.read();
    // Said once, and nothing touched by reading.
    expect(logged).toEqual([
      `the model record at ${path} could not be read: selection starts without it, and the file is kept aside before anything replaces it`,
    ]);
    expect(await readFile(path, "utf8")).toBe(bytes);
    await recordOutcome(record, "gemma", "complete");
    const aside = (await files()).filter((name) => name.includes(".unreadable-"));
    expect(aside).toHaveLength(1);
    expect(await readFile(join(dirname(path), aside[0] ?? ""), "utf8")).toBe(bytes);
    expect(logged[1]).toBe(
      `the model record at ${path} could not be read and is replaced: its bytes are kept at ${join(dirname(path), aside[0] ?? "")}`,
    );
    expect(JSON.parse(await readFile(path, "utf8")).outcomes.gemma.complete).toBe(1);
  });

  it("keeps aside a file of a version it does not know, too", async () => {
    const bytes = `${JSON.stringify({ version: 3, machine, probes: {}, outcomes: {} })}\n`;
    const { home, path, files } = await homeWith(bytes);
    await recordOutcome(modelRecord(home), "gemma", "complete");
    const aside = (await files()).filter((name) => name.includes(".unreadable-"));
    expect(await readFile(join(dirname(path), aside[0] ?? ""), "utf8")).toBe(bytes);
  });

  it("is read as empty where another machine wrote it, and kept aside on the first write", async () => {
    const bytes = v1({ gemma }, { ...machine, totalMemory: machine.totalMemory + 1 });
    const { home, path, logged, log, files } = await homeWith(bytes);
    const record = modelRecord(home, { log });
    expect((await record.read()).outcomes).toEqual({});
    expect(logged[0]).toContain("was written on another machine");
    await recordOutcome(record, "gemma", "complete");
    await recordOutcome(record, "gemma", "complete");
    const aside = (await files()).filter((name) => name.includes(".other-machine-"));
    expect(aside).toHaveLength(1);
    expect(await readFile(join(dirname(path), aside[0] ?? ""), "utf8")).toBe(bytes);
    expect(await files()).toHaveLength(2);
  });
});

describe("the default profile", () => {
  it("is byte-identical after runs under a named profile and after runs that record nothing", async () => {
    for (const bytes of [v1({ gemma }), "not a profile"]) {
      const { home, path, files } = await homeWith(bytes);
      const dev = modelRecord(home, { profile: "dev" });
      await recordOutcome(dev, "gemma", "unattributed");
      await recordOutcome(dev, "gemma", "model");
      const silent = modelRecord(home, { write: false });
      await recordOutcome(silent, "gemma", "model");
      expect(await readFile(path, "utf8")).toBe(bytes);
      // The named profile's own file is the only one added: no backup of a file left untouched.
      expect(await files()).toEqual([`${hostname()}.json`, `${hostname()}@dev.json`]);
    }
    // A named profile starts from the default's counts, migrated.
    const { home } = await homeWith(v1({ gemma }));
    const dev = modelRecord(home, { profile: "dev" });
    await recordOutcome(dev, "gemma", "unattributed");
    expect((await dev.read()).outcomes.gemma).toMatchObject({
      complete: 12,
      other: 2,
      legacyOther: 2,
      unattributed: 1,
    });
  });
});
