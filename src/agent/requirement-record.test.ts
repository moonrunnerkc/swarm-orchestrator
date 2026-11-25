import { describe, expect, it } from "vitest";
import {
  applyProposal,
  initialRecord,
  obligationsOf,
  recordSha256,
  withAuthored,
} from "./requirement-record.ts";

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
    // Quoting the task does not make the model's own entry the user's requirement.
    expect(record.requirements[1]).toMatchObject({ id: "R2", source: "inferred", required: false });
  });

  it("records what the model adds as its own suggestion, never required, whatever it claims", () => {
    const record = applyProposal(
      task,
      initialRecord(task),
      JSON.stringify([
        { id: "R2", text: "Also add YAML", source: "user", kind: "feature", required: true },
      ]),
    );
    expect(record.requirements.map((one) => [one.id, one.source, one.required])).toEqual([
      ["R1", "user", true],
      ["R2", "inferred", false],
    ]);
    expect(record.notes[0]).toMatch(/^R2 was added during the work/);
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

describe("what the check-authoring stage holds on R1", () => {
  const task = "move _falsify into claims.py";
  const authoredClaim = {
    path: "src/claims.py",
    contains: "def _falsify(",
    authority: "independently-generated" as const,
  };
  const held = withAuthored(initialRecord(task), "refactor", [authoredClaim]);

  it("keeps the authored kind and claims whatever a proposal says, and says so", () => {
    const next = applyProposal(
      task,
      held,
      JSON.stringify([
        { id: "R1", text: task, kind: "other", evidence: { structure: [{ path: "x.py" }] } },
      ]),
    );
    const r1 = next.requirements[0];
    expect(r1?.kind).toBe("refactor");
    expect(r1?.evidence.structure).toEqual([
      authoredClaim,
      { path: "x.py", authority: "implementation-authored" },
    ]);
    expect(next.notes).toContain(
      "R1's kind is refactor, fixed when its checks were written; a proposal cannot change it",
    );
    expect(next.held).toEqual(held.held);
  });

  it("marks every claim a proposal names as the implementation's own, whatever authority it gives", () => {
    const next = applyProposal(
      task,
      initialRecord(task),
      JSON.stringify([
        {
          id: "R2",
          text: "pin vitest",
          kind: "upgrade",
          evidence: {
            packages: [{ name: "vitest", ecosystem: "npm", authority: "user-acceptance" }],
          },
        },
      ]),
    );
    expect(next.requirements[1]?.evidence.packages[0]?.authority).toBe("implementation-authored");
  });

  it("says nothing about the kind when a proposal leaves R1 out", () => {
    const next = applyProposal(
      task,
      held,
      JSON.stringify([{ id: "R2", text: "also tidy", kind: "other" }]),
    );
    expect(next.notes).toEqual([]);
    expect(next.requirements[0]?.kind).toBe("refactor");
  });
});

describe("an upgrade whose author found a code change to check", () => {
  // claimcheck's upgrade (2026-11-05, rc.10): the versions alone read satisfied.
  const task = "vitest to ^5, and move the Stryker version claimcheck installs to 10.x";
  it("holds R1 to a test of that change, whatever a proposal says", () => {
    const held = withAuthored(initialRecord(task), "upgrade", [], true);
    expect(held.requirements[0]?.behaviorAsked).toBe(true);
    const next = applyProposal(
      task,
      held,
      JSON.stringify([{ id: "R1", text: task, kind: "upgrade", behaviorAsked: false }]),
    );
    expect(next.requirements[0]?.behaviorAsked).toBe(true);
  });
});

describe("the parts of the task the user set apart", () => {
  const listed = [
    "Rework the status command:",
    "- add a --json option",
    "- keep the text output as it is",
    "2. document the option in the README",
  ].join("\n");

  it("reads each item of a list the task holds, in the task's own words", () => {
    expect(obligationsOf(listed)).toEqual({
      obligations: [
        "add a --json option",
        "keep the text output as it is",
        "document the option in the README",
      ],
      refused: [],
    });
  });

  it("does not split prose, or take one bullet for a list", () => {
    expect(obligationsOf(task).obligations).toEqual([]);
    expect(obligationsOf("Fix the parser.\n- see issue 12").obligations).toEqual([]);
  });

  it("takes a --require quote the task holds, and refuses a paraphrase or the whole task", () => {
    expect(obligationsOf(task, ["Keep the text   output as it is"])).toEqual({
      obligations: ["Keep the text output as it is"],
      refused: [],
    });
    const refused = obligationsOf(task, ["keep stdout unchanged", task]).refused;
    expect(refused[0]).toContain("does not quote the task");
    expect(refused[1]).toContain("is the whole task");
  });

  it("names one obligation once, however it was set apart", () => {
    expect(obligationsOf(listed, ["add a --json option"]).obligations).toHaveLength(3);
  });

  const start = initialRecord(listed, [], [], obligationsOf(listed).obligations);

  it("records each as a required requirement of the user's, after R1", () => {
    expect(start.requirements.map((one) => [one.id, one.source, one.required, one.text])).toEqual([
      ["R1", "user", true, listed],
      ["R2", "user", true, "add a --json option"],
      ["R3", "user", true, "keep the text output as it is"],
      ["R4", "user", true, "document the option in the README"],
    ]);
  });

  it("keeps every obligation when a proposal leaves it out", () => {
    const next = applyProposal(
      listed,
      start,
      JSON.stringify([{ id: "R1", text: listed, kind: "feature" }]),
    );
    expect(next.requirements.map((one) => one.id)).toEqual(["R1", "R2", "R3", "R4"]);
    expect(next.requirements.every((one) => one.required)).toBe(true);
  });

  it("refuses a proposal that rewords, downgrades or maps its own evidence onto one", () => {
    const next = applyProposal(
      listed,
      start,
      JSON.stringify([
        { id: "R2", text: "add some option", kind: "feature" },
        { id: "R3", text: "keep the text output as it is", kind: "other", required: false },
        {
          id: "R4",
          text: "document the option in the README",
          kind: "other",
          evidence: { structure: [{ path: "README.md", contains: "--json" }] },
        },
      ]),
    );
    expect(next.requirements).toEqual(start.requirements);
    expect(next.notes).toHaveLength(2);
    expect(next.notes[0]).toContain("R2 is part of the task as the user wrote it");
  });

  it("holds the check stage's kind and claims on an obligation, by its id", () => {
    const claim = {
      path: "README.md",
      contains: "--json",
      authority: "independently-generated" as const,
    };
    const held = withAuthored(start, "other", [claim], false, [], "R4");
    expect(held.requirements[3]?.evidence.structure).toEqual([claim]);
    expect(held.requirements[0]?.evidence.structure).toEqual([]);
    const next = applyProposal(
      listed,
      held,
      JSON.stringify([{ id: "R9", text: "tidy", kind: "other" }]),
    );
    expect(next.requirements[3]?.evidence.structure).toEqual([claim]);
    expect(next.requirements.at(-1)).toMatchObject({
      id: "R9",
      required: false,
      source: "inferred",
    });
  });

  it("gives a suggestion a new id of its own, never one already fixed", () => {
    const next = applyProposal(
      listed,
      start,
      JSON.stringify([{ id: "R3", text: "something else entirely", kind: "other" }]),
    );
    expect(next.requirements.find((one) => one.id === "R3")?.text).toBe(
      "keep the text output as it is",
    );
  });
});
