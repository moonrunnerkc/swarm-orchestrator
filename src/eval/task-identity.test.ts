import { describe, expect, it } from "vitest";
import { duplicateOf, taskIdentity } from "./task-identity.ts";

const dayjs3180 = {
  repository: "iamkun/dayjs",
  pull: 3180,
  baseCommit: "ae3a55025cdf0f06c8705b5e8b61cd4edb33697a",
  testFile: "test/plugin/timezone.test.js",
  sealedCases: ["does not throw for invalid Day.js values (regression #111.22)"],
  heldBackCases: ["does not throw for invalid string in d.tz()"],
};
const dayjs3181 = { ...dayjs3180, pull: 3181 };

describe("taskIdentity", () => {
  /**
   * Two pull requests can carry one specification. dayjs#3180 and #3181 sit on the same base
   * commit, add the same cases to the same file, and #3181's own title references #3180. Scored as
   * two they are two opportunities for a false green, and a blind spot in that one pair of oracles
   * would produce two of them, which is one finding counted twice.
   */
  it("gives one name to two pull requests carrying one specification", () => {
    expect(taskIdentity(dayjs3180)).toBe(taskIdentity(dayjs3181));
  });

  it("tells apart tasks that differ in the base, the file or either half", () => {
    expect(taskIdentity({ ...dayjs3180, baseCommit: "0000000" })).not.toBe(taskIdentity(dayjs3180));
    expect(taskIdentity({ ...dayjs3180, testFile: "test/other.js" })).not.toBe(
      taskIdentity(dayjs3180),
    );
    expect(taskIdentity({ ...dayjs3180, sealedCases: ["something else"] })).not.toBe(
      taskIdentity(dayjs3180),
    );
    expect(taskIdentity({ ...dayjs3180, heldBackCases: ["something else"] })).not.toBe(
      taskIdentity(dayjs3180),
    );
  });

  // The halves are a set, not a sequence: the same two cases dealt in either order are the same
  // specification, and a corpus that thought otherwise would keep both.
  it("does not depend on the order the cases were dealt in", () => {
    const one = { ...dayjs3180, sealedCases: ["a", "b"], heldBackCases: ["c", "d"] };
    const other = { ...one, sealedCases: ["b", "a"], heldBackCases: ["d", "c"] };

    expect(taskIdentity(one)).toBe(taskIdentity(other));
  });
});

describe("duplicateOf", () => {
  it("names the earlier pull request as the one to keep", () => {
    expect(duplicateOf(dayjs3181, [dayjs3180])?.pull).toBe(3180);
  });

  // Order of arrival must not decide which survives, or a corpus keeps whichever was checked
  // first and a re-check of the same candidates can change what it holds.
  it("is not a duplicate of a later pull request", () => {
    expect(duplicateOf(dayjs3180, [dayjs3181])).toBeNull();
  });

  it("is not a duplicate of itself", () => {
    expect(duplicateOf(dayjs3180, [dayjs3180])).toBeNull();
  });

  it("finds nothing where no kept task carries the same specification", () => {
    expect(duplicateOf(dayjs3181, [{ ...dayjs3180, testFile: "test/other.js" }])).toBeNull();
  });
});
