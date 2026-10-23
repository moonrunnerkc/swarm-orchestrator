import { describe, expect, it } from "vitest";
import { normalizeDiagnosis, parseDiagnosis } from "./agent-decision-point.ts";
import { predictionHolds } from "./core/working-state.ts";

/** Shapes of the three answers development run 2 refused whole, abbreviated. */
describe("reading a diagnosis answer field by field", () => {
  it("keeps a prediction given as a list of texts, and holds it only when every text is printed", () => {
    const { diagnosis } = normalizeDiagnosis({
      hypotheses: [
        {
          statement: "errors are lost in parseSubscripts",
          predicts: { outputIncludes: ["Shorthand", "(1:4)"] },
        },
      ],
    });
    const predicts = diagnosis.hypotheses?.[0]?.predicts ?? {};
    expect(predicts).toEqual({ outputIncludes: ["Shorthand", "(1:4)"] });
    expect(
      predictionHolds(predicts, { exitCode: 1, output: "SyntaxError: Shorthand ... (1:4)" }),
    ).toBe(true);
    expect(
      predictionHolds(predicts, { exitCode: 1, output: "SyntaxError: Shorthand ... (1:8)" }),
    ).toBe(false);
  });

  it("reads a null field as absent and cuts a long approach instead of refusing the answer", () => {
    const { diagnosis, dropped } = normalizeDiagnosis({
      question: null,
      hypotheses: [],
      locations: [{ path: "src/escape.ts", line: "187", why: "returns NaN" }],
      approach: `Use Number.NaN in src/escape.ts. ${"x".repeat(2000)}`,
    });
    expect(diagnosis.question).toBeUndefined();
    expect(diagnosis.locations).toEqual([{ path: "src/escape.ts", line: 187, why: "returns NaN" }]);
    expect(diagnosis.approach).toHaveLength(1500);
    expect(dropped).toEqual([]);
  });

  it("drops a malformed entry by name and keeps the rest", () => {
    const { diagnosis, dropped } = normalizeDiagnosis({
      hypotheses: [{ predicts: { exitCode: 1 } }, { statement: "the getter is not wrapped" }],
      locations: [
        { path: "src/a.js" },
        { path: "src/b.js", line: 0 },
        { path: "src/c.js", line: 4 },
      ],
      test: { command: `node -e "${"x".repeat(500)}"` },
    });
    expect(diagnosis.hypotheses).toEqual([{ statement: "the getter is not wrapped" }]);
    expect(diagnosis.locations).toEqual([{ path: "src/c.js", line: 4 }]);
    // A command is run as written or not at all.
    expect(diagnosis.test).toBeUndefined();
    expect(dropped).toHaveLength(4);
  });

  it("recovers only path and line pairs from an answer whose JSON does not parse", () => {
    const broken =
      '{"hypotheses":[{"statement":"wrap the getter"}],"test":{"command":"node -e \\"\\nconst a = 1;\\n\\" 2>&1","exitCode":0},"locations":[{"path":"src/sinon/default-behaviors.js","line":214,"why":"get"}] x}';
    const parsed = parseDiagnosis(broken);
    expect(parsed.diagnosis).toEqual({
      locations: [{ path: "src/sinon/default-behaviors.js", line: 214 }],
    });
    expect(parsed.error).toMatch(/not JSON .*1 location\(s\) recovered/);
    expect(parseDiagnosis("Read the code carefully.")).toEqual({
      diagnosis: null,
      error: "no JSON object in the answer",
    });
  });
});
