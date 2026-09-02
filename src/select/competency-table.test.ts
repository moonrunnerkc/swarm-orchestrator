import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CalibrationRunFacts,
  competenciesFor,
  competencyFloor,
  emptyCompetencyTable,
  lookupCompetency,
  readCompetencyTable,
  sweepFromRuns,
  withSweep,
  writeCompetencyTable,
} from "./competency-table.ts";

const golden = "sha256:golden";

function runs(
  model: string,
  taskClass: "edit" | "test-fix",
  outcomes: readonly ("pass" | "fail" | "skip")[],
): CalibrationRunFacts[] {
  return outcomes.map((outcome) => ({
    model,
    taskClass,
    executed: outcome !== "skip",
    gatePassed: outcome === "pass",
  }));
}

function sweep(sessionId: string, facts: readonly CalibrationRunFacts[]) {
  return sweepFromRuns({ sessionId, goldenSetVersion: golden, recordedAt: 1 }, facts);
}

describe("building a sweep from its run records", () => {
  it("counts executed repeats and the ones whose gate passed, per model and class", () => {
    const built = sweep("s1", [
      ...runs("local:a", "edit", ["pass", "pass", "fail"]),
      ...runs("local:a", "test-fix", ["fail"]),
      ...runs("local:b", "edit", ["pass"]),
    ]);

    expect(built.entries).toEqual([
      { model: "local:a", taskClass: "edit", executed: 3, gatePassed: 2 },
      { model: "local:a", taskClass: "test-fix", executed: 1, gatePassed: 0 },
      { model: "local:b", taskClass: "edit", executed: 1, gatePassed: 1 },
    ]);
  });

  it("counts a repeat the model never answered for nothing, not as a failure", () => {
    const built = sweep("s1", runs("local:a", "edit", ["skip", "skip", "pass"]));

    expect(built.entries).toEqual([
      { model: "local:a", taskClass: "edit", executed: 1, gatePassed: 1 },
    ]);
  });
});

describe("folding sweeps", () => {
  it("adds a later sweep's samples to an earlier one's on the same golden set", () => {
    const table = withSweep(
      withSweep(emptyCompetencyTable(), sweep("s1", runs("local:a", "edit", ["pass", "fail"]))),
      sweep("s2", runs("local:a", "edit", ["pass", "pass"])),
    );

    expect(competenciesFor(table, "edit", golden)).toEqual([
      {
        model: "local:a",
        taskClass: "edit",
        executed: 4,
        gatePassed: 3,
        gateShare: 0.75,
        sweeps: 2,
      },
    ]);
  });

  it("records a sweep once, under its session id", () => {
    const first = sweep("s1", runs("local:a", "edit", ["pass"]));
    const table = withSweep(withSweep(emptyCompetencyTable(), first), first);

    expect(table.sweeps).toHaveLength(1);
  });

  it("never folds in a sweep of another golden set", () => {
    const other = sweepFromRuns(
      { sessionId: "s9", goldenSetVersion: "sha256:other", recordedAt: 1 },
      runs("local:a", "edit", ["pass", "pass", "pass"]),
    );
    const table = withSweep(emptyCompetencyTable(), other);

    expect(competenciesFor(table, "edit", golden)).toEqual([]);
  });
});

describe("looking a class up", () => {
  const table = withSweep(
    withSweep(
      emptyCompetencyTable(),
      sweep("s1", [
        ...runs("local:a", "edit", ["pass", "pass", "pass", "fail", "fail", "fail"]),
        ...runs("local:b", "edit", ["pass", "pass", "pass", "pass", "pass", "fail"]),
        ...runs("local:a", "test-fix", ["pass", "pass"]),
      ]),
    ),
    sweep("s2", runs("local:c", "edit", ["pass", "pass", "pass", "pass", "pass", "pass", "pass"])),
  );

  it("picks the candidate with the best gate share among those at or above the floor", () => {
    const lookup = lookupCompetency({
      table,
      taskClass: "edit",
      goldenSetVersion: golden,
      candidates: ["local:a", "local:b"],
    });

    expect(lookup.abstained).toBe(false);
    expect(lookup.pick).toBe("local:b");
    expect(lookup.reason).toContain("passed the gate on 5 of 6 executed edit run(s)");
    expect(lookup.floor).toBe(competencyFloor);
  });

  it("considers only the candidates the router may choose between", () => {
    const lookup = lookupCompetency({
      table,
      taskClass: "edit",
      goldenSetVersion: golden,
      candidates: ["local:a", "local:b", "local:c"],
    });

    expect(lookup.pick).toBe("local:c");
    expect(
      lookupCompetency({
        table,
        taskClass: "edit",
        goldenSetVersion: golden,
        candidates: ["local:a"],
      }).pick,
    ).toBe("local:a");
  });

  it("abstains by name where no candidate clears the floor, rather than picking on a guess", () => {
    const lookup = lookupCompetency({
      table,
      taskClass: "test-fix",
      goldenSetVersion: golden,
      candidates: ["local:a", "local:b"],
    });

    expect(lookup.abstained).toBe(true);
    expect(lookup.pick).toBeNull();
    expect(lookup.reason).toBe(
      "local:a has 2 executed run(s) on this class, and 6 are needed before the table says anything, so the default stands",
    );
  });

  it("never interpolates a class a model has no entry for", () => {
    const lookup = lookupCompetency({
      table,
      taskClass: "multi-file",
      goldenSetVersion: golden,
      candidates: ["local:a", "local:b", "local:c"],
    });

    expect(lookup.abstained).toBe(true);
    expect(lookup.reason).toContain("no candidate has an executed run on this class");
  });

  it("breaks a tie toward the candidate listed first, which is where the caller puts its default", () => {
    const tied = withSweep(
      emptyCompetencyTable(),
      sweep("s1", [
        ...runs("local:x", "edit", ["pass", "pass", "pass", "pass", "pass", "pass"]),
        ...runs("local:y", "edit", ["pass", "pass", "pass", "pass", "pass", "pass"]),
      ]),
    );

    expect(
      lookupCompetency({
        table: tied,
        taskClass: "edit",
        goldenSetVersion: golden,
        candidates: ["local:y", "local:x"],
      }).pick,
    ).toBe("local:y");
  });
});

describe("the table on disk", () => {
  const scratch: string[] = [];
  afterEach(async () => {
    for (const directory of scratch.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads an absent table as empty and writes what it is given", async () => {
    const directory = await mkdtemp(join(tmpdir(), "competency-"));
    scratch.push(directory);
    const path = join(directory, "routing", "competency-table.json");

    expect(await readCompetencyTable(path)).toEqual(emptyCompetencyTable());
    const table = withSweep(emptyCompetencyTable(), sweep("s1", runs("local:a", "edit", ["pass"])));
    await writeCompetencyTable(path, table);

    expect(await readCompetencyTable(path)).toEqual(table);
    expect(JSON.parse(await readFile(path, "utf8")).schemaVersion).toBe(1);
  });
});
