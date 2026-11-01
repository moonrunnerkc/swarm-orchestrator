import { describe, expect, it } from "vitest";
import { applyProposal, initialRecord, recordSha256 } from "./requirement-record.ts";

const task = "Add a --json option to status. Keep the text output as it is.";

describe("the requirement record", () => {
  it("starts with the task itself as R1, verbatim, from the user", () => {
    expect(initialRecord(task).requirements).toEqual([
      expect.objectContaining({ id: "R1", text: task, source: "user", kind: "other" }),
    ]);
  });

  it("keeps R1's wording and source whatever a proposal says, and takes its kind and evidence", () => {
    const record = applyProposal(
      task,
      initialRecord(task),
      JSON.stringify([
        {
          id: "R1",
          text: "something easier",
          source: "inferred",
          kind: "feature",
          evidence: { tests: [{ name: "json" }] },
        },
        { id: "R2", text: "Keep the text output as it is.", source: "user", kind: "refactor" },
      ]),
    );
    expect(record.requirements[0]).toMatchObject({
      id: "R1",
      text: task,
      source: "user",
      kind: "feature",
    });
    expect(record.requirements[0]?.evidence.tests).toEqual([{ name: "json" }]);
    expect(record.requirements[1]).toMatchObject({ id: "R2", source: "user" });
  });

  it("records a requirement claiming to be the user's as inferred unless it quotes the task", () => {
    const record = applyProposal(
      task,
      initialRecord(task),
      JSON.stringify([{ id: "R2", text: "Also add YAML", source: "user", kind: "feature" }]),
    );
    expect(record.requirements.map((one) => [one.id, one.source])).toEqual([
      ["R1", "user"],
      ["R2", "inferred"],
    ]);
    expect(record.notes).toEqual(["R2 does not quote the task, so it is recorded as inferred"]);
  });

  it("keeps the record and says why when a proposal does not parse or validate", () => {
    const start = initialRecord(task);
    expect(applyProposal(task, start, "not json").requirements).toEqual(start.requirements);
    const bad = applyProposal(
      task,
      start,
      JSON.stringify([{ id: "Q9", text: "x", kind: "feature" }]),
    );
    expect(bad.requirements.map((one) => one.id)).toEqual(["R1"]);
    expect(bad.notes[0]).toMatch(/^Q9 was not recorded: id/);
  });

  it("holds the task's version constraints on R1, and no proposal rewrites, drops or adds one", () => {
    const upgrade =
      "Bump vitest from 4.1.8 to 4.1.10 (or both Stryker packages to the latest 9.x if one exists).";
    const stryker = {
      name: "@stryker-mutator/core",
      ecosystem: "npm" as const,
      range: "9.x",
      latest: true,
      wording: "Stryker packages to the latest 9.x",
    };
    const start = initialRecord(upgrade, [stryker]);
    const rewritten = { ...stryker, range: "10.x", latest: false };
    const record = applyProposal(
      upgrade,
      start,
      JSON.stringify([
        { id: "R1", text: upgrade, source: "user", kind: "upgrade", versions: [rewritten] },
        { id: "R2", text: "keep the tests green", kind: "other", versions: [rewritten] },
      ]),
    );
    expect(record.requirements[0]).toMatchObject({ kind: "upgrade", versions: [stryker] });
    expect(record.requirements[1]?.versions).toEqual([]);
    expect(record.notes).toEqual([
      "R1's versions come from the task's wording and are kept as read; a proposal cannot change them",
      "R2's versions come from the task's wording and are kept as read; a proposal cannot change them",
    ]);
    const dropped = applyProposal(
      upgrade,
      start,
      JSON.stringify([{ id: "R1", text: upgrade, kind: "upgrade", versions: [] }]),
    );
    expect(dropped.requirements[0]?.versions).toEqual([stryker]);
  });

  it("digests the record so a later report cannot swap it", () => {
    const a = recordSha256(initialRecord(task));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(recordSha256(initialRecord(`${task} `))).not.toBe(a);
  });
});
