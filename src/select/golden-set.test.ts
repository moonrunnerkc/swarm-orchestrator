import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CalibrationCase } from "./calibration-case.ts";
import {
  appendCalibrationCase,
  DuplicateCalibrationCaseError,
  defaultGoldenSetPath,
  readGoldenSet,
} from "./golden-set.ts";
import { taskClasses } from "./task-class.ts";

const run = promisify(execFile);

/** The case's own gate command, run where its seed was written. */
async function runInDirectory(command: string, cwd: string): Promise<number> {
  try {
    await run(command, { cwd, shell: true, timeout: 30_000 });
    return 0;
  } catch (cause) {
    return (cause as { code?: number }).code ?? 1;
  }
}

let directory = "";
let localPath = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "swarm-golden-"));
  localPath = join(directory, "cases.jsonl");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function captured(id: string): CalibrationCase {
  return {
    id,
    taskClass: "edit",
    prompt: "make the thing work",
    seed: { "thing.mjs": "export const thing = 1;\n" },
    gateCommand: "node --test",
    origin: "captured",
    addedAt: "2026-08-13",
  };
}

describe("the bundled golden set", () => {
  it("ships a case for each of the four strata, so calibration is stratified", async () => {
    const set = await readGoldenSet({ localPath });

    expect([...new Set(set.cases.map((one) => one.taskClass))].sort()).toEqual(
      [...taskClasses].sort(),
    );
  });

  it("ships cases that seed a workspace and name the command that judges them", async () => {
    const set = await readGoldenSet({ localPath });

    for (const one of set.cases) {
      expect(Object.keys(one.seed).length).toBeGreaterThan(0);
      expect(one.gateCommand.length).toBeGreaterThan(0);
      expect(one.origin).toBe("bundled");
    }
  });

  it("names the set by its ordered contents, so a report cites what it ran", async () => {
    const set = await readGoldenSet({ localPath });

    expect(set.version).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await readGoldenSet({ localPath })).version).toBe(set.version);
  });
});

describe("capturing a case", () => {
  it("appends it permanently, after the cases that were already there", async () => {
    const before = await readGoldenSet({ localPath });

    const after = await appendCalibrationCase({ localPath }, captured("captured-one"));

    expect(after.cases).toHaveLength(before.cases.length + 1);
    expect(after.cases[after.cases.length - 1]?.id).toBe("captured-one");
    expect(after.capturedCount).toBe(1);
  });

  it("changes the version, because the set it measures against is now a different set", async () => {
    const before = await readGoldenSet({ localPath });

    const after = await appendCalibrationCase({ localPath }, captured("captured-one"));

    expect(after.version).not.toBe(before.version);
  });

  it("only ever adds, so an earlier capture is still there byte for byte", async () => {
    await appendCalibrationCase({ localPath }, captured("first"));
    const afterFirst = await readFile(localPath, "utf8");

    await appendCalibrationCase({ localPath }, captured("second"));

    expect((await readFile(localPath, "utf8")).startsWith(afterFirst)).toBe(true);
  });

  it("refuses an id the set already carries, because a case cannot be replaced", async () => {
    await appendCalibrationCase({ localPath }, captured("first"));

    await expect(appendCalibrationCase({ localPath }, captured("first"))).rejects.toThrow(
      DuplicateCalibrationCaseError,
    );
  });

  it("refuses to shadow a bundled case", async () => {
    const bundled = (await readGoldenSet({ localPath })).cases[0];

    await expect(
      appendCalibrationCase({ localPath }, { ...captured("x"), id: bundled?.id ?? "" }),
    ).rejects.toThrow(DuplicateCalibrationCaseError);
  });
});

describe("a damaged local set", () => {
  it("refuses a line it cannot read, naming which one, rather than measuring against less", async () => {
    await appendCalibrationCase({ localPath }, captured("first"));
    await appendFile(localPath, "{not json}\n");

    await expect(readGoldenSet({ localPath })).rejects.toThrow(/line 2/);
  });
});

describe("where captured cases live", () => {
  it("sits beside the session store, outside every workspace", () => {
    expect(defaultGoldenSetPath("/home/dev")).toBe("/home/dev/.swarm/calibration/cases.jsonl");
  });
});

describe("what the bundled cases are worth", () => {
  it("starts every case red, because a case that passes on its seed measures nothing", async () => {
    const set = await readGoldenSet({ localPath });

    for (const one of set.cases) {
      const scratch = await mkdtemp(join(tmpdir(), `swarm-case-${one.id}-`));
      try {
        for (const [path, contents] of Object.entries(one.seed)) {
          await mkdir(dirname(join(scratch, path)), { recursive: true });
          await writeFile(join(scratch, path), contents, "utf8");
        }
        const exitCode = await runInDirectory(one.gateCommand, scratch);
        expect(exitCode, `${one.id} passed on its own seed`).not.toBe(0);
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }
  });
});
