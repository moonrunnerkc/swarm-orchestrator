import { describe, expect, it } from "vitest";
import {
  DECISION,
  classifyResidualDelta,
  collectStreamJsonText,
  diffIdSets,
  evaluateLap,
  extractTrailingJsonlBlock,
  formatFindingsForPrompt,
  formatFocusFromFixerItems,
  parseAgentReport,
  parseJsonl,
  parseVitestCounts,
  renderSummary,
  renderSummaryEntry,
  residualHoldIds,
  sortFindingsBySeverity,
} from "./evaluate.mjs";

function attackerRow(overrides) {
  return {
    id: "A1",
    part: "coverage",
    result: "caught",
    severity: "mechanical",
    mechanism: "src/gates/coverage-artifact.ts:41 + ratchet",
    evidence: "one line",
    framing: "what was tried",
    regression_test: null,
    golden_case: null,
    ...overrides,
  };
}

function fixerRow(overrides) {
  return {
    item: "1",
    addresses: ["A1"],
    root_cause: "one line",
    approach: "one line",
    proved_by: "acceptance shown",
    files: ["src/gates/coverage-artifact.ts"],
    residual_delta: "none",
    reverted_prior_fix: null,
    ...overrides,
  };
}

const greenGates = { passed: true, testsPassed: 840 };

describe("parseJsonl", () => {
  it("keeps good rows and reports bad lines instead of throwing", () => {
    const { rows, errors } = parseJsonl('{"id":"A1"}\n\nnot json\n{"id":"A2"}\n');
    expect(rows.map((row) => row.id)).toEqual(["A1", "A2"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
  });

  it("rejects a line that parses to a non-object", () => {
    const { rows, errors } = parseJsonl("[1,2]\n42\n");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(2);
  });
});

describe("extractTrailingJsonlBlock", () => {
  it("takes the last jsonl fence, not an earlier example block", () => {
    const text = [
      "Some prose.",
      "```jsonl",
      '{"id":"OLD"}',
      "```",
      "More prose.",
      "```jsonl",
      '{"id":"A1"}',
      '{"id":"A2"}',
      "```",
    ].join("\n");
    expect(extractTrailingJsonlBlock(text)).toBe('{"id":"A1"}\n{"id":"A2"}\n');
  });

  it("falls back to an unlabelled fence whose every line is a JSON object", () => {
    const text = ["prose", "```", '{"id":"A1"}', "```"].join("\n");
    expect(extractTrailingJsonlBlock(text)).toBe('{"id":"A1"}\n');
  });

  it("never takes a fence that is not line-delimited JSON", () => {
    const text = ["prose", "```bash", "npm run gates", "```"].join("\n");
    expect(extractTrailingJsonlBlock(text)).toBeNull();
  });
});

describe("collectStreamJsonText", () => {
  it("prefers the result event's final text", () => {
    const stdout = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}',
      '{"type":"result","subtype":"success","result":"final text"}',
    ].join("\n");
    expect(collectStreamJsonText(stdout)).toBe("final text");
  });

  it("concatenates assistant text when the stream ends without a result", () => {
    const stdout = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"a"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"b"}]}}',
    ].join("\n");
    expect(collectStreamJsonText(stdout)).toBe("ab");
  });

  it("passes plain text through untouched", () => {
    expect(collectStreamJsonText("no json here\n```jsonl\n")).toBe("no json here\n```jsonl\n");
  });
});

describe("parseAgentReport", () => {
  it("walks stream-json stdout all the way to rows", () => {
    const inner = ["Findings table.", "```jsonl", '{"id":"A1","result":"succeeded"}', "```"].join("\n");
    const stdout = `${JSON.stringify({ type: "result", subtype: "success", result: inner })}\n`;
    const report = parseAgentReport(stdout, { streamJson: true });
    expect(report.rows).toEqual([{ id: "A1", result: "succeeded" }]);
    expect(report.errors).toEqual([]);
  });

  it("returns a null block when the agent emitted no report", () => {
    const report = parseAgentReport("I could not finish.", { streamJson: false });
    expect(report.block).toBeNull();
    expect(report.rows).toEqual([]);
  });
});

describe("prompt fill helpers", () => {
  it("sorts findings trust-root, mechanical, doc and formats id: mechanism (evidence)", () => {
    const rows = [
      attackerRow({ id: "D1", severity: "doc", mechanism: "docs drift", evidence: "e-d1" }),
      attackerRow({ id: "M1", severity: "mechanical", mechanism: "marker bypass", evidence: "e-m1" }),
      attackerRow({ id: "T1", severity: "trust-root", mechanism: "claim binding", evidence: "e-t1" }),
    ];
    expect(sortFindingsBySeverity(rows).map((row) => row.id)).toEqual(["T1", "M1", "D1"]);
    expect(formatFindingsForPrompt(rows)).toBe(
      ["T1: claim binding (e-t1)", "M1: marker bypass (e-m1)", "D1: docs drift (e-d1)"].join("\n"),
    );
  });

  it("builds focus text from the fixer's own items", () => {
    const focus = formatFocusFromFixerItems([
      fixerRow({ item: "1", addresses: ["A2", "D2"], approach: "move the boundary", files: ["src/a.ts"] }),
    ]);
    expect(focus).toContain("item 1 (closes A2, D2): move the boundary [files: src/a.ts]");
  });

  it("states the null focus when no fix pass ran", () => {
    expect(formatFocusFromFixerItems([])).toContain("No fix pass ran before this lap");
  });
});

describe("residual set handling", () => {
  it("collects residual-holds ids, deduped and sorted", () => {
    const ids = residualHoldIds([
      attackerRow({ id: "R2", result: "residual-holds" }),
      attackerRow({ id: "R1", result: "residual-holds" }),
      attackerRow({ id: "R1", result: "residual-holds" }),
      attackerRow({ id: "A9", result: "caught" }),
    ]);
    expect(ids).toEqual(["R1", "R2"]);
  });

  it("diffs two sets both ways", () => {
    expect(diffIdSets(["R1", "R2"], ["R2", "R3"])).toEqual({
      added: ["R3"],
      removed: ["R1"],
      changed: true,
    });
  });

  it("reads the residual_delta grammar and flags anything outside it", () => {
    expect(classifyResidualDelta("none").kind).toBe("none");
    expect(classifyResidualDelta("added: R5 lcov section ordering")).toMatchObject({
      kind: "added",
      detail: "R5 lcov section ordering",
    });
    expect(classifyResidualDelta("removed: R2")).toMatchObject({ kind: "removed", detail: "R2" });
    expect(classifyResidualDelta(undefined).kind).toBe("unexplained");
    expect(classifyResidualDelta("").kind).toBe("unexplained");
    expect(classifyResidualDelta("probably fine").kind).toBe("unexplained");
    expect(classifyResidualDelta("added:").kind).toBe("unexplained");
  });
});

describe("parseVitestCounts", () => {
  it("reads a green tail", () => {
    const output = " Test Files  78 passed (78)\n      Tests  840 passed (840)\n";
    expect(parseVitestCounts(output)).toEqual({ testsPassed: 840, testsFailed: 0, filesPassed: 78 });
  });

  it("reads a mixed tail", () => {
    const output = " Test Files  1 failed | 77 passed (78)\n      Tests  2 failed | 838 passed (840)\n";
    expect(parseVitestCounts(output)).toMatchObject({ testsPassed: 838, testsFailed: 2 });
  });

  it("returns null when vitest never printed a count", () => {
    expect(parseVitestCounts("tsc exited 2").testsPassed).toBeNull();
  });
});

describe("evaluateLap routing", () => {
  it("converges on a clean lap: no successes, residual set held, gates green, no deltas", () => {
    const evaluation = evaluateLap({
      lap: 4,
      attackerRows: [
        attackerRow({ id: "A1", result: "caught" }),
        attackerRow({ id: "R1", result: "residual-holds", severity: "residual" }),
        attackerRow({ id: "R2", result: "residual-holds", severity: "residual" }),
      ],
      fixerRows: [fixerRow({ item: "1", residual_delta: "none" })],
      priorResidualIds: ["R1", "R2"],
      gates: greenGates,
      priorTestCount: 838,
    });
    expect(evaluation.decision).toBe(DECISION.converged);
    expect(evaluation.wakeReasons).toEqual([]);
    expect(evaluation.convergeBlockers).toEqual([]);
    expect(renderSummary(evaluation)).toContain("residual set unchanged: R1, R2");
  });

  it("converges on lap 1 with no prior residual set to compare against", () => {
    const evaluation = evaluateLap({
      lap: 1,
      attackerRows: [attackerRow({ id: "R1", result: "residual-holds", severity: "residual" })],
      fixerRows: [],
      priorResidualIds: null,
      gates: greenGates,
      priorTestCount: null,
    });
    expect(evaluation.decision).toBe(DECISION.converged);
    expect(evaluation.residualDiff.baseline).toBe(true);
  });

  it("wakes a human on a trust-root success", () => {
    const evaluation = evaluateLap({
      lap: 2,
      attackerRows: [
        attackerRow({
          id: "T1",
          result: "succeeded",
          severity: "trust-root",
          mechanism: "src/evidence/claim-resolution.ts:88 + invariant 1",
          regression_test: "redteam/pass5/closures.regression.ts",
        }),
        attackerRow({ id: "R1", result: "residual-holds", severity: "residual" }),
      ],
      fixerRows: [fixerRow()],
      priorResidualIds: ["R1"],
      gates: greenGates,
      priorTestCount: 840,
    });
    expect(evaluation.decision).toBe(DECISION.wake);
    expect(evaluation.wakeReasons.join(" ")).toContain("trust-root severity: T1");
    expect(renderSummary(evaluation)).toContain("[trust-root] T1");
  });

  it("wakes a human when the residual set changed, even with only mechanical successes", () => {
    const evaluation = evaluateLap({
      lap: 3,
      attackerRows: [
        attackerRow({ id: "M1", result: "succeeded", severity: "mechanical" }),
        attackerRow({ id: "R1", result: "residual-holds", severity: "residual" }),
        attackerRow({ id: "R9", result: "residual-holds", severity: "residual" }),
      ],
      fixerRows: [fixerRow()],
      priorResidualIds: ["R1", "R2"],
      gates: greenGates,
      priorTestCount: 840,
    });
    expect(evaluation.decision).toBe(DECISION.wake);
    expect(evaluation.wakeReasons.join(" ")).toContain("residual set changed: added R9; removed R2");
  });

  it("wakes a human when the fixer declares a residual change the attacker set has not shown yet", () => {
    const evaluation = evaluateLap({
      lap: 3,
      attackerRows: [attackerRow({ id: "R1", result: "residual-holds", severity: "residual" })],
      fixerRows: [fixerRow({ item: "2", residual_delta: "added: R7 cross-line non-JSON credential" })],
      priorResidualIds: ["R1"],
      gates: greenGates,
      priorTestCount: 840,
    });
    expect(evaluation.decision).toBe(DECISION.wake);
    expect(evaluation.wakeReasons.join(" ")).toContain("fixer declared a residual change");
  });

  it("wakes a human when the fixer backed out a prior fix on an otherwise clean lap", () => {
    const evaluation = evaluateLap({
      lap: 5,
      attackerRows: [attackerRow({ id: "R1", result: "residual-holds", severity: "residual" })],
      fixerRows: [fixerRow({ item: "1", reverted_prior_fix: "9b2a0945" })],
      priorResidualIds: ["R1"],
      gates: greenGates,
      priorTestCount: 840,
    });
    expect(evaluation.decision).toBe(DECISION.wake);
    expect(evaluation.wakeReasons.join(" ")).toContain("reverts 9b2a0945");
  });

  it("wakes a human when gates failed", () => {
    const evaluation = evaluateLap({
      lap: 2,
      attackerRows: [attackerRow({ id: "R1", result: "residual-holds", severity: "residual" })],
      fixerRows: [fixerRow()],
      priorResidualIds: ["R1"],
      gates: { passed: false, testsPassed: 838 },
      priorTestCount: 840,
    });
    expect(evaluation.decision).toBe(DECISION.wake);
    expect(evaluation.wakeReasons).toContain("gates failed");
    expect(renderSummary(evaluation)).toContain("gates: FAIL");
  });

  it("continues on mechanical and doc successes only", () => {
    const evaluation = evaluateLap({
      lap: 2,
      attackerRows: [
        attackerRow({ id: "M1", result: "succeeded", severity: "mechanical" }),
        attackerRow({ id: "D1", result: "succeeded", severity: "doc" }),
        attackerRow({ id: "R1", result: "residual-holds", severity: "residual" }),
      ],
      fixerRows: [fixerRow()],
      priorResidualIds: ["R1"],
      gates: greenGates,
      priorTestCount: 840,
    });
    expect(evaluation.decision).toBe(DECISION.continue);
    expect(evaluation.wakeReasons).toEqual([]);
    expect(evaluation.successesBySeverity).toEqual({ mechanical: 1, doc: 1 });
  });

  it("does not converge when a passing test count fell, and says so", () => {
    const evaluation = evaluateLap({
      lap: 4,
      attackerRows: [attackerRow({ id: "R1", result: "residual-holds", severity: "residual" })],
      fixerRows: [fixerRow()],
      priorResidualIds: ["R1"],
      gates: { passed: true, testsPassed: 830 },
      priorTestCount: 840,
    });
    expect(evaluation.decision).toBe(DECISION.continue);
    expect(evaluation.convergeBlockers.join(" ")).toContain("passing test count fell from 840 to 830");
  });

  it("does not converge on an unexplained residual_delta", () => {
    const evaluation = evaluateLap({
      lap: 4,
      attackerRows: [attackerRow({ id: "R1", result: "residual-holds", severity: "residual" })],
      fixerRows: [fixerRow({ item: "3", residual_delta: "probably fine" })],
      priorResidualIds: ["R1"],
      gates: greenGates,
      priorTestCount: 840,
    });
    expect(evaluation.decision).toBe(DECISION.continue);
    expect(evaluation.convergeBlockers.join(" ")).toContain("unexplained residual_delta");
    expect(renderSummary(evaluation)).toContain("UNEXPLAINED");
  });

  it("wakes a human when a report could not be read, never scoring it as a quiet lap", () => {
    const evaluation = evaluateLap({
      lap: 3,
      attackerRows: [],
      fixerRows: [],
      priorResidualIds: [],
      gates: greenGates,
      priorTestCount: 840,
      reportProblems: ["lap 3 attacker emitted no jsonl block"],
    });
    expect(evaluation.decision).toBe(DECISION.wake);
    expect(evaluation.wakeReasons.join(" ")).toContain("emitted no jsonl block");
    expect(evaluation.convergeBlockers.join(" ")).toContain("emitted no jsonl block");
  });

  it("prefers waking a human over converging when both are satisfiable", () => {
    const evaluation = evaluateLap({
      lap: 6,
      attackerRows: [],
      fixerRows: [fixerRow({ reverted_prior_fix: "deadbeef" })],
      priorResidualIds: [],
      gates: greenGates,
      priorTestCount: 840,
    });
    expect(evaluation.convergeBlockers).toEqual([]);
    expect(evaluation.decision).toBe(DECISION.wake);
  });
});

describe("renderSummaryEntry", () => {
  it("writes one summary.md section carrying the lap's route and why", () => {
    const evaluation = evaluateLap({
      lap: 2,
      attackerRows: [attackerRow({ id: "M1", result: "succeeded", severity: "mechanical" })],
      fixerRows: [fixerRow({ item: "1" }), fixerRow({ item: "2" })],
      priorResidualIds: [],
      gates: greenGates,
      priorTestCount: 840,
    });
    const entry = renderSummaryEntry(evaluation, { itemsFixed: ["1", "2"], timestamp: "2026-08-14T18:00:00Z" });
    expect(entry).toContain("## lap 2 (2026-08-14T18:00:00Z)");
    expect(entry).toContain("- items fixed: item 1, item 2");
    expect(entry).toContain("- successes by severity: mechanical=1");
    expect(entry).toContain("- residual set: unchanged");
    expect(entry).toContain("- gates: pass (840 tests passed)");
    expect(entry).toContain("- decision: CONTINUE");
    expect(entry.endsWith("\n\n")).toBe(true);
  });
});
