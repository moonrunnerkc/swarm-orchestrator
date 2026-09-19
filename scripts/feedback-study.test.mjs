import { describe, expect, it } from "vitest";
import { capCohort } from "./feedback-study.mjs";

const task = (repository, number) => ({ id: `${repository}#${number}`, repository });
const keyOf = (one) => one.id;

describe("the cohort cap", () => {
  it("keeps every historical task, even in a repository already above the cap", () => {
    const historical = Array.from({ length: 5 }, (_, at) => task("big/one", at + 1));
    const others = Array.from({ length: 15 }, (_, at) => task(`r/${at}`, 1));
    const capped = capCohort({
      tasks: [...historical, ...others],
      historicalIds: new Set(historical.map((one) => one.id)),
      capShare: 0.1,
      keyOf,
    });
    expect(capped.kept).toHaveLength(20);
    expect(capped.setAside).toEqual([]);
    expect(capped.overCap).toEqual([{ repository: "big/one", tasks: 5 }]);
  });

  it("sets aside new tasks of an over-cap repository by the largest key, one at a time", () => {
    const fresh = Array.from({ length: 6 }, (_, at) => task("new/many", at + 1));
    const others = Array.from({ length: 24 }, (_, at) => task(`r/${at}`, 1));
    const capped = capCohort({
      tasks: [...fresh, ...others],
      historicalIds: new Set(),
      capShare: 0.1,
      keyOf,
    });
    // 30 tasks allow 3 per repository, and setting aside three leaves 27, which allows 2.
    expect(capped.kept.filter((one) => one.repository === "new/many").map((one) => one.id)).toEqual(
      ["new/many#1", "new/many#2"],
    );
    expect(capped.setAside.map((one) => one.id)).toEqual([
      "new/many#6",
      "new/many#5",
      "new/many#4",
      "new/many#3",
    ]);
    expect(capped.overCap).toEqual([]);
  });

  it("is the same cohort whatever order the viability record lists tasks in", () => {
    const tasks = [
      ...Array.from({ length: 7 }, (_, at) => task("new/many", at + 1)),
      ...Array.from({ length: 30 }, (_, at) => task(`r/${at}`, 1)),
    ];
    const once = capCohort({ tasks, historicalIds: new Set(), capShare: 0.1, keyOf });
    const reversed = capCohort({
      tasks: [...tasks].reverse(),
      historicalIds: new Set(),
      capShare: 0.1,
      keyOf,
    });
    const ids = (result) => result.kept.map((one) => one.id).sort();
    expect(ids(reversed)).toEqual(ids(once));
    expect(reversed.setAside).toEqual(once.setAside);
  });
});
