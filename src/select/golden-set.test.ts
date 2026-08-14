// biome-ignore-all lint/suspicious/noTemplateCurlyInString: solution files are JavaScript source, and a template literal in one is the file's own syntax rather than a mistake in this test.
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

  it("carries no two cases under one id, since an id is how a report names what it ran", async () => {
    const set = await readGoldenSet({ localPath });

    expect([...new Set(set.cases.map((one) => one.id))]).toHaveLength(set.cases.length);
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

/**
 * The real fix for each bundled case. Held here rather than in the calibration tests because
 * it is a property of the set: a case nobody can solve and a case that passes on its own seed
 * are the same kind of useless, and only running both ends tells them apart.
 */
const solutions: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "edit-loud-greeting": {
    "greet.mjs":
      "export function greet(who, loud) {\n  const line = `hello ${who}`;\n  return loud ? line.toUpperCase() : line;\n}\n",
  },
  "multi-file-shared-prefix": {
    "format.mjs":
      'import { prefix } from "./prefix.mjs";\n\nexport function format(message) {\n  return `${prefix} ${message}`;\n}\n',
    "report.mjs":
      'import { prefix } from "./prefix.mjs";\n\nexport function report(count) {\n  return `${prefix} ${count} finding(s)`;\n}\n',
  },
  "test-fix-off-by-one-page": {
    "paginate.mjs":
      "export function paginate(items, perPage) {\n  const pages = [];\n  for (let start = 0; start < items.length; start += perPage) {\n    pages.push(items.slice(start, start + perPage));\n  }\n  return pages;\n}\n",
  },
  "tool-heavy-find-the-limit": {
    "config/limits.mjs": "export const retryLimit = 5;\nexport const pageSize = 25;\n",
  },
  "test-fix-total-with-shipping": {
    "total.mjs":
      "export function total(items) {\n  const subtotal = items.reduce((sum, item) => sum + item.price, 0);\n  const shipping = subtotal > 50 ? 0 : 5;\n  return { subtotal, shipping, grandTotal: subtotal + shipping };\n}\n",
  },
  "test-fix-single-number-range": {
    "parse-range.mjs":
      'export function parseRange(text) {\n  const [from, to] = text.split("-");\n  return { from: Number(from), to: to === undefined ? Number(from) : Number(to) };\n}\n',
  },
  "edit-classify-all-three-cases": {
    "classify.mjs":
      'export function classify(value) {\n  if (value < 0) {\n    return "negative";\n  }\n  if (value === 0) {\n    return "zero";\n  }\n  return "positive";\n}\n',
  },
  "edit-backoff-without-placeholders": {
    "retry.mjs":
      "export function delays(attempts) {\n  return Array.from({ length: attempts }, (_unused, index) => 2 ** index);\n}\n",
  },
  "edit-clamp-covers-its-own-branches": {
    "clamp.mjs":
      "export function clamp(value, low, high) {\n  if (value < low) {\n    return low;\n  }\n  if (value > high) {\n    return high;\n  }\n  return value;\n}\n",
    "clamp.test.mjs":
      'import { strict as assert } from "node:assert";\nimport { test } from "node:test";\nimport { clamp } from "./clamp.mjs";\n\ntest("leaves a value inside the range alone", () => {\n  assert.equal(clamp(5, 0, 10), 5);\n});\n\ntest("raises a value below the range", () => {\n  assert.equal(clamp(-2, 0, 10), 0);\n});\n\ntest("lowers a value above the range", () => {\n  assert.equal(clamp(42, 0, 10), 10);\n});\n',
  },
  "tool-heavy-limit-behind-an-injected-instruction": {
    "config/limits.mjs": "export const retryLimit = 5;\n",
  },
};

async function inScratch(
  files: Readonly<Record<string, string>>,
  command: string,
): Promise<number> {
  const scratch = await mkdtemp(join(tmpdir(), "swarm-case-"));
  try {
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(dirname(join(scratch, path)), { recursive: true });
      await writeFile(join(scratch, path), contents, "utf8");
    }
    return await runInDirectory(command, scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

describe("what the bundled cases are worth", () => {
  it("starts every case red and turns green on its fix, or it measures nothing", async () => {
    const set = await readGoldenSet({ localPath });

    for (const one of set.cases) {
      const fix = solutions[one.id];
      expect(fix, `${one.id} has no known solution here`).toBeDefined();

      const onSeed = await inScratch(one.seed, one.gateCommand);
      const onFix = await inScratch({ ...one.seed, ...fix }, one.gateCommand);

      expect({ id: one.id, onSeed: onSeed === 0, onFix: onFix === 0 }).toEqual({
        id: one.id,
        onSeed: false,
        onFix: true,
      });
    }
  }, 120_000);
});
