import { describe, expect, it } from "vitest";
import {
  authorTools,
  judgeTools,
  promptDigest,
  scoreRow,
  traceHolds,
  validateAuthorFinish,
} from "./reviewers.mjs";

const accept = (path) => ({ refusal: null, path });
const check = (path) => ({ path, contents: `// ${path}`, command: `node ${path}`, asserts: "a" });

describe("validateAuthorFinish", () => {
  it("accepts requirements with two checks, or one with its reason", () => {
    const validated = validateAuthorFinish(
      {
        unjudged: false,
        reason: "",
        taskType: "bugfix",
        requirements: [
          {
            id: "R1",
            text: "adds two numbers",
            quote: "fix add",
            checks: [check("a.mjs"), check("b.mjs")],
          },
          {
            id: "R2",
            text: "exports add",
            quote: "export",
            singleCheckReason: "one symbol",
            checks: [check("c.mjs")],
          },
        ],
      },
      accept,
    );
    expect(validated.accepted.requirements.map((requirement) => requirement.checks.length)).toEqual(
      [2, 1],
    );
    expect(validated.accepted.requirements[0].checks[0].digest).toMatch(/^sha256:/);
  });

  it("refuses a single unexplained check, a shared path, a bad task type and a refused path", () => {
    const one = {
      taskType: "bugfix",
      requirements: [{ id: "R1", text: "t", quote: "q", checks: [check("a.mjs")] }],
    };
    expect(validateAuthorFinish(one, accept).refusal).toMatch(/second independent check/);
    const shared = {
      taskType: "bugfix",
      requirements: [
        {
          id: "R1",
          text: "t",
          quote: "q",
          checks: [check("a.mjs"), { ...check("a.mjs"), contents: "// other bytes" }],
        },
      ],
    };
    expect(validateAuthorFinish(shared, accept).refusal).toMatch(/different contents/);
    // One file carrying two checks, each selected by its own command, is accepted.
    const oneFile = {
      taskType: "bugfix",
      requirements: [
        {
          id: "R1",
          text: "t",
          quote: "q",
          checks: [check("t.py"), { ...check("t.py"), command: "python -m pytest t.py::test_b" }],
        },
      ],
    };
    expect(
      validateAuthorFinish(oneFile, accept).accepted.requirements[0].checks.map((c) => c.id),
    ).toEqual(["R1.C1", "R1.C2"]);
    expect(validateAuthorFinish({ ...shared, taskType: "chore" }, accept).refusal).toMatch(
      /taskType/,
    );
    const refused = validateAuthorFinish(
      {
        taskType: "bugfix",
        requirements: [
          { id: "R1", text: "t", quote: "q", checks: [check("a.mjs"), check("b.mjs")] },
        ],
      },
      () => ({ refusal: "refused: exists" }),
    );
    expect(refused.refusal).toBe("refused: exists");
    expect(validateAuthorFinish({ unjudged: true, reason: "docs only" }, accept).accepted).toEqual({
      unjudged: true,
      reason: "docs only",
    });
  });
});

// Scoring keys checks by id; here each check's id is its file name.
const withId = (path) => ({ ...check(path), id: path });
const author = (taskType = "bugfix") => ({
  unjudged: false,
  taskType,
  needs: [],
  requirements: [
    { id: "R1", text: "t1", checks: [withId("a.mjs"), withId("b.mjs")] },
    { id: "R2", text: "t2", checks: [withId("c.mjs"), withId("d.mjs")] },
  ],
});
const blind = { taskType: "bugfix", executable: true, requirements: [] };
const judgeAll = (overrides = {}) => ({
  taskType: "bugfix",
  uncovered: [],
  requirements: [
    { id: "R1", stated: "yes", reason: "" },
    { id: "R2", stated: "yes", reason: "" },
  ],
  checks: ["a.mjs", "b.mjs", "c.mjs", "d.mjs"].map((id) => ({
    id,
    valid: "valid",
    reason: "",
  })),
  ...overrides,
});
const outcomesOf = (decisions, truthClass = "behavioural-executed") =>
  Object.fromEntries(
    Object.entries(decisions).map(([path, decision]) => [
      path,
      { decision, reason: decision, truthClass },
    ]),
  );
const allMet = outcomesOf({ "a.mjs": "met", "b.mjs": "met", "c.mjs": "met", "d.mjs": "met" });

describe("scoreRow", () => {
  it("scores met only when both reviewers agree and every requirement's accepted checks agree", () => {
    const truth = scoreRow({ author: author(), blind, judge: judgeAll(), outcomes: allMet });
    expect(truth).toMatchObject({ class: "behavioural-executed", status: "requirement-met" });
    expect(truth.disagreements).toEqual([]);
  });

  it("leaves a requirement the second reviewer rejects, or is unsure of, unscored", () => {
    for (const stated of ["no", "uncertain"]) {
      const judge = judgeAll({
        requirements: [
          { id: "R1", stated: "yes" },
          { id: "R2", stated, reason: "why" },
        ],
      });
      const truth = scoreRow({ author: author(), blind, judge, outcomes: allMet });
      expect(truth.status).toBeNull();
      expect(truth.reason).toMatch(/R2/);
      expect(stated === "no" ? truth.disagreements : truth.uncertainty).toContainEqual(
        expect.objectContaining({ about: "R2" }),
      );
    }
  });

  it("drops invalid checks and leaves disagreeing checks unscored", () => {
    const judge = judgeAll({
      checks: [
        { id: "a.mjs", valid: "valid" },
        { id: "b.mjs", valid: "invalid", reason: "asserts too much" },
        { id: "c.mjs", valid: "valid" },
        { id: "d.mjs", valid: "valid" },
      ],
    });
    const outcomes = outcomesOf({
      "a.mjs": "met",
      "b.mjs": "violated",
      "c.mjs": "met",
      "d.mjs": "violated",
    });
    const truth = scoreRow({ author: author(), blind, judge, outcomes });
    expect(truth.requirements[0].behavioural.status).toBe("requirement-met");
    expect(truth.requirements[1].behavioural.reason).toBe("the accepted checks disagree");
    expect(truth.status).toBeNull();
  });

  it("scores a violation from agreed, validly executed checks", () => {
    const outcomes = outcomesOf({
      "a.mjs": "violated",
      "b.mjs": "violated",
      "c.mjs": "met",
      "d.mjs": "unjudged",
    });
    expect(scoreRow({ author: author(), blind, judge: judgeAll(), outcomes }).status).toBe(
      "requirement-violated",
    );
  });

  it("does not score across a refactor disagreement or an uncovered requirement", () => {
    const refactor = scoreRow({
      author: author("refactor"),
      blind,
      judge: judgeAll(),
      outcomes: allMet,
    });
    expect(refactor.status).toBeNull();
    expect(refactor.reason).toMatch(/refactor/);
    const uncovered = scoreRow({
      author: author(),
      blind,
      judge: judgeAll({ uncovered: ["logs the error"] }),
      outcomes: allMet,
    });
    expect(uncovered.status).toBeNull();
    const featureVsBugfix = scoreRow({
      author: author("feature"),
      blind,
      judge: judgeAll(),
      outcomes: allMet,
    });
    expect(featureVsBugfix.status).toBe("requirement-met");
    expect(featureVsBugfix.disagreements).toContainEqual(
      expect.objectContaining({ about: "taskType" }),
    );
  });

  it("reports text-inspected results apart from task truth", () => {
    const outcomes = outcomesOf(
      { "a.mjs": "met", "b.mjs": "met", "c.mjs": "met", "d.mjs": "met" },
      "text-inspected",
    );
    const truth = scoreRow({ author: author(), blind, judge: judgeAll(), outcomes });
    expect(truth).toMatchObject({ class: "text-inspected", status: "requirement-met" });
    expect(truth.reason).toMatch(/not task truth/);
  });

  it("is unscored when the author abstains or the second reviewer is silent", () => {
    expect(
      scoreRow({ author: { unjudged: true, reason: "docs" }, blind, judge: null, outcomes: {} })
        .class,
    ).toBe("unscored");
    expect(
      scoreRow({ author: author(), blind: null, judge: null, outcomes: allMet }).reason,
    ).toMatch(/second reviewer/);
  });
});

describe("traceHolds and prompt digests", () => {
  it("holds only when every quote is really in the text", () => {
    const text = "The total must include tax.";
    expect(
      traceHolds(
        { traceable: true, mapping: [{ assertion: "a", quote: "must include tax" }] },
        text,
      ).traceable,
    ).toBe(true);
    expect(
      traceHolds({ traceable: true, mapping: [{ assertion: "a", quote: "must round up" }] }, text)
        .traceable,
    ).toBe(false);
    expect(traceHolds({ traceable: true, mapping: [] }, text).traceable).toBe(false);
  });

  it("binds a digest to the prompt and the tool schema", () => {
    expect(promptDigest("a", authorTools)).not.toBe(promptDigest("a", judgeTools));
    expect(promptDigest("a", authorTools)).toBe(promptDigest("a", authorTools));
  });
});
