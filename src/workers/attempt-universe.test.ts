import { describe, expect, it } from "vitest";
import { emptyMeasureSnapshot, type MeasureSnapshot } from "../gates/measure-snapshot.ts";
import { emptyTestFileMeasures, type TestFileMeasures } from "../gates/measures.ts";
import { totalsOverFixedUniverse } from "./attempt-universe.ts";

function file(tests: number, assertions: number, skips = 0): TestFileMeasures {
  return { ...emptyTestFileMeasures, tests, assertions, skips };
}

function snapshot(
  touched: Record<string, TestFileMeasures>,
  atBase: Record<string, TestFileMeasures>,
): MeasureSnapshot {
  return { ...emptyMeasureSnapshot, perTestFile: touched, perTestFileAtBase: atBase };
}

/** A repository whose one existing test file is large, which is the file worth importing. */
const bigAtBase = { "big.test.ts": file(50, 100, 3) };

describe("totals over a universe fixed across attempts", () => {
  it("counts a file an attempt never touched at the content it had at the base", () => {
    const added = snapshot({ "new.test.ts": file(2, 4) }, bigAtBase);
    const untouched = snapshot({}, bigAtBase);

    const [first, second] = totalsOverFixedUniverse([added, untouched]);

    expect(first).toEqual({ tests: 52, assertions: 104, skips: 3 });
    expect(second).toEqual({ tests: 50, assertions: 100, skips: 3 });
  });

  it("gives nothing to an attempt that touched a large test file without adding to it", () => {
    const wroteTests = snapshot({ "new.test.ts": file(2, 4) }, bigAtBase);
    const touchedTheBigFile = snapshot({ "big.test.ts": file(50, 100, 3) }, bigAtBase);

    const [added, imported] = totalsOverFixedUniverse([wroteTests, touchedTheBigFile]);

    expect(added?.assertions).toBeGreaterThan(imported?.assertions ?? 0);
    expect(added?.tests).toBeGreaterThan(imported?.tests ?? 0);
  });

  it("credits an attempt that actually added tests to the large file", () => {
    const wroteTests = snapshot({ "new.test.ts": file(2, 4) }, bigAtBase);
    const grewTheBigFile = snapshot({ "big.test.ts": file(56, 118, 3) }, bigAtBase);

    const [added, grew] = totalsOverFixedUniverse([wroteTests, grewTheBigFile]);

    expect(grew?.assertions).toBeGreaterThan(added?.assertions ?? 0);
  });

  it("returns one total per attempt, in the order they were given", () => {
    const totals = totalsOverFixedUniverse([
      snapshot({ "a.test.ts": file(1, 1) }, {}),
      snapshot({ "b.test.ts": file(3, 9) }, {}),
      snapshot({}, {}),
    ]);

    expect(totals).toHaveLength(3);
    expect(totals.map((total) => total.assertions)).toEqual([1, 9, 0]);
  });

  it("counts a file no attempt has at the base as absent rather than assuming it", () => {
    const totals = totalsOverFixedUniverse([
      snapshot({ "a.test.ts": file(1, 1) }, {}),
      snapshot({}, {}),
    ]);

    expect(totals[1]).toEqual({ tests: 0, assertions: 0, skips: 0 });
  });

  it("reads one attempt's base content for a file another attempt tracked at base", () => {
    const knowsTheBase = snapshot({}, bigAtBase);
    const doesNot = snapshot({}, {});

    const [, borrowed] = totalsOverFixedUniverse([knowsTheBase, doesNot]);

    expect(borrowed).toEqual({ tests: 50, assertions: 100, skips: 3 });
  });

  it("has nothing to total when there are no attempts", () => {
    expect(totalsOverFixedUniverse([])).toEqual([]);
  });
});
