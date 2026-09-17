import { describe, expect, it } from "vitest";
import type { CompetencyTable } from "./competency-table.ts";
import { routingCandidates } from "./routing-candidates.ts";

/**
 * The state on one machine: the pick on disk was the last sweep's pair, gemma4 and mistral,
 * while the table had folded four models across five sweeps and qwen3.6 held the best edit
 * share of all. The router only ever chose between the pair, so qwen3.6 was never in the
 * running for a task it had the most evidence for.
 */
const golden = "sha256:golden-v1";

const table: CompetencyTable = {
  schemaVersion: 1,
  sweeps: [
    {
      sessionId: "s1",
      goldenSetVersion: golden,
      recordedAt: 1,
      entries: [
        { model: "local:qwen3.6:35b-a3b", taskClass: "edit", executed: 27, gatePassed: 25 },
        { model: "local:qwen3.6:35b-a3b", taskClass: "tool-heavy", executed: 6, gatePassed: 4 },
      ],
    },
    {
      sessionId: "s2",
      goldenSetVersion: golden,
      recordedAt: 2,
      entries: [
        { model: "local:qwen3.8:27b", taskClass: "edit", executed: 27, gatePassed: 24 },
        { model: "local:qwen3.8:27b", taskClass: "multi-file", executed: 3, gatePassed: 1 },
      ],
    },
    {
      sessionId: "s3",
      goldenSetVersion: golden,
      recordedAt: 3,
      entries: [
        { model: "local:gemma4:31b", taskClass: "edit", executed: 27, gatePassed: 26 },
        { model: "local:mistral-small3.2:24b", taskClass: "edit", executed: 24, gatePassed: 0 },
      ],
    },
    {
      sessionId: "older-set",
      goldenSetVersion: "sha256:golden-v0",
      recordedAt: 0,
      entries: [{ model: "local:ancient:7b", taskClass: "edit", executed: 30, gatePassed: 30 }],
    },
  ],
};

const pick = {
  model: "local:gemma4:31b",
  candidates: ["local:gemma4:31b", "local:mistral-small3.2:24b"],
  goldenSetVersion: golden,
  recordedAt: 3,
};

describe("who the router may choose between", () => {
  it("adds every model the table measured on this class at or above the floor, after the pick's own", () => {
    expect(routingCandidates({ pick, table, taskClass: "edit" })).toEqual([
      "local:gemma4:31b",
      "local:mistral-small3.2:24b",
      "local:qwen3.6:35b-a3b",
      "local:qwen3.8:27b",
    ]);
  });

  it("leaves out a model under the floor on this class, which is a guess with a number on it", () => {
    expect(routingCandidates({ pick, table, taskClass: "multi-file" })).toEqual(pick.candidates);
  });

  it("leaves out a model measured only on another golden set", () => {
    const candidates = routingCandidates({ pick, table, taskClass: "edit" });
    expect(candidates).not.toContain("local:ancient:7b");
  });

  it("keeps a model measured on another class out of this one, since the table never interpolates", () => {
    // qwen3.6 has tool-heavy evidence at the floor and qwen3.8 has none.
    expect(routingCandidates({ pick, table, taskClass: "tool-heavy" })).toEqual([
      ...pick.candidates,
      "local:qwen3.6:35b-a3b",
    ]);
  });

  it("is the pick's own list where the table is empty", () => {
    expect(
      routingCandidates({ pick, table: { schemaVersion: 1, sweeps: [] }, taskClass: "edit" }),
    ).toEqual(pick.candidates);
  });
});
