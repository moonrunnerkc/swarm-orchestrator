import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FileSetState } from "./file-set.ts";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import { inspectionGates } from "./inspection-gates.ts";
import { takeMeasureSnapshot } from "./measure-snapshot.ts";
import { judgeRatchet } from "./ratchet.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";
import { reconstructSides } from "./unified-diff.ts";

/**
 * Replays v12's synthetic falsification corpus (section 3.10, input 4) against this
 * phase's gates. Each case is a stored patch, so both sides are reconstructed from the
 * patch itself and the static gates and the numeric ratchet are run over them.
 *
 * What this can and cannot show is the point of recording the numbers per category. The
 * ratchet's four numerics catch the categories that move a count: assertions removed,
 * tests removed, skips added. They do not catch a category that keeps every count and
 * changes what an assertion means, and no proxy is substituted for one, because a
 * fabricated verdict is worse than a recorded gap. Coverage of changed lines is measured
 * from an executed run, which a stored patch has no way to provide, so the categories that
 * need it are reported here as out of reach of a static replay rather than as passes.
 */

const run = promisify(execFile);
const corpusPath = "benchmarks/falsification-corpus/v10-synthetic-corpus";

/** Deterministic, and small enough that the sample runs with the ordinary suite. */
const casesPerSide = 10;

let corpusRoot: string | null = null;

interface CategoryTally {
  readonly brokenRejected: number;
  readonly brokenSampled: number;
  readonly cleanRejected: number;
  readonly cleanSampled: number;
}

beforeAll(async () => {
  const extractTo = await mkdtemp(join(tmpdir(), "swarm-corpus-"));
  try {
    // One archive rather than a thousand git invocations. The corpus lives on the branch
    // v13 replaced, which is exactly how section 3.10 says to reach it.
    await run("sh", [
      "-c",
      `git archive main ${corpusPath} | tar -x -C ${JSON.stringify(extractTo)}`,
    ]);
    corpusRoot = join(extractTo, corpusPath);
    await readdir(corpusRoot);
  } catch {
    await rm(extractTo, { recursive: true, force: true });
    corpusRoot = null;
  }
}, 60_000);

afterAll(async () => {
  if (corpusRoot !== null) {
    await rm(join(corpusRoot, "..", "..", ".."), { recursive: true, force: true });
  }
});

function declaredFor(paths: Iterable<string>): FileSetState {
  const allowed = new Set(paths);
  return {
    declared: [...allowed],
    amendments: [],
    allowed,
    wasDeclared: true,
    editedBeforeAuthorized: [],
  };
}

async function inspect(gate: GateDefinition, context: GateContext): Promise<boolean> {
  if (gate.source.kind !== "inspection") {
    return false;
  }
  const reading = gate.parse(await gate.source.inspect(context));
  return reading.status === "failed" && gate.severity === "blocking";
}

/**
 * One stored patch, judged the way a retry would be: the static gates over the change, and
 * the ratchet between the patch's two sides.
 */
async function rejects(patch: string): Promise<boolean> {
  const sides = reconstructSides(patch);
  const base: Record<string, string> = {};
  const head: Record<string, string> = {};
  for (const [path, { base: before, head: after }] of sides) {
    base[path] = before;
    head[path] = after;
  }

  const submitted = createMemoryWorkspace({ base, current: head });
  const original = createMemoryWorkspace({ base, current: base });
  const changes = await submitted.changes();

  const context: GateContext = {
    workspaceRoot: "/corpus",
    changes,
    // The patch is granted its own files, so the file-set gate is not the trivial rejecter
    // and the categories get judged on their merits.
    fileSet: declaredFor(Object.keys(head)),
    budgets: { maxChangedFiles: 50, maxAddedLines: 5000 },
    probe: submitted,
  };

  for (const gate of inspectionGates) {
    if (await inspect(gate, context)) {
      return true;
    }
  }

  const shared = { changes, trackedTestFiles: [], gateMeasures: {}, gateOutputs: [] };
  const decision = judgeRatchet({
    baselineGates: {},
    candidateGates: {},
    baseline: await takeMeasureSnapshot({ ...shared, probe: original }),
    candidate: await takeMeasureSnapshot({ ...shared, probe: submitted }),
    exemptFiles: new Set(),
  });

  return !decision.accepted;
}

async function tally(category: string): Promise<CategoryTally> {
  const counts = { brokenRejected: 0, brokenSampled: 0, cleanRejected: 0, cleanSampled: 0 };

  for (const side of ["broken", "clean"] as const) {
    const directory = join(corpusRoot ?? "", category, side);
    const names = (await readdir(directory)).filter((name) => name.endsWith(".diff")).sort();
    for (const name of names.slice(0, casesPerSide)) {
      const rejected = await rejects(await readFile(join(directory, name), "utf8"));
      if (side === "broken") {
        counts.brokenSampled += 1;
        counts.brokenRejected += rejected ? 1 : 0;
      } else {
        counts.cleanSampled += 1;
        counts.cleanRejected += rejected ? 1 : 0;
      }
    }
  }

  return counts;
}

describe("replaying the v12 falsification corpus against these gates", () => {
  it("rejects every case in the categories the four numerics are meant to catch", async (context) => {
    if (corpusRoot === null) {
      // The corpus lives on main, which a shallow clone will not have. Skip visibly rather
      // than return: a silent return renders green and reads as a corpus that was checked.
      context.skip();
      return;
    }

    for (const category of ["assertion-strip", "comment-only-fix"]) {
      const counts = await tally(category);
      expect({ category, ...counts }).toEqual({
        category,
        brokenRejected: casesPerSide,
        brokenSampled: casesPerSide,
        cleanRejected: 0,
        cleanSampled: casesPerSide,
      });
    }
  }, 60_000);

  it("rejects no legitimate control in any category, which is the cost side of the ratchet", async (context) => {
    if (corpusRoot === null) {
      context.skip();
      return;
    }

    const categories = (await readdir(corpusRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const falsePositives: Record<string, number> = {};
    for (const category of categories) {
      const counts = await tally(category);
      if (counts.cleanRejected > 0) {
        falsePositives[category] = counts.cleanRejected;
      }
    }

    expect(falsePositives).toEqual({});
  }, 120_000);

  it("records which categories a static replay leaves undecided, rather than claiming them", async (context) => {
    if (corpusRoot === null) {
      context.skip();
      return;
    }

    const undecided: string[] = [];
    for (const category of [
      "coverage-erosion",
      "dead-branch-insertion",
      "test-relaxation",
      "no-op-fix",
      "error-swallow",
      "exception-rethrow-lost-context",
      "fake-refactor",
      "mock-of-hallucination",
    ]) {
      const counts = await tally(category);
      if (counts.brokenRejected === 0) {
        undecided.push(category);
      }
    }

    // These keep every number a static replay can read. Coverage erosion and dead-branch
    // insertion are caught by the changed-line coverage measure, but only from an executed
    // run, which a stored patch cannot supply; acceptance.test.ts drives that same shape
    // through a real test run and the ratchet rejects it there. The remaining six need a
    // semantic judgement, which is a stated non-goal, and no proxy stands in for one.
    expect(undecided).toEqual([
      "coverage-erosion",
      "dead-branch-insertion",
      "test-relaxation",
      "no-op-fix",
      "error-swallow",
      "exception-rethrow-lost-context",
      "fake-refactor",
      "mock-of-hallucination",
    ]);
  }, 120_000);
});
