import { describe, expect, it } from "vitest";
import {
  admitObjections,
  admitProbes,
  type CaseAnswer,
  classifyProbe,
  findingsBrief,
  objectionsBrief,
  type ProbeRun,
  probeObligations,
  type ReviewProbe,
  readAnswers,
  remeasure,
  reviewParts,
} from "./agent-review.ts";

const task =
  "Add a `strict` option to parse(). Without the option, parse() behaves as it does today. With strict: true, a trailing comma throws a SyntaxError.";

const answered = (...texts: readonly (string | "threw" | "raised")[]): ProbeRun => ({
  kind: "answered",
  answers: texts.map(
    (text): CaseAnswer =>
      text === "threw"
        ? { kind: "threw", inProgram: false }
        : text === "raised"
          ? { kind: "threw", inProgram: true }
          : { kind: "result", text },
  ),
});
const twice = (run: ProbeRun) => [run, run] as const;

const preserve: ReviewProbe = {
  id: "default-parse",
  basis: "preserve",
  keeps: "parse without options",
  program: "import { parse } from './index.js'; export default (text) => parse(text);",
  cases: [{ input: "[1,2]" }, { input: "[1,]" }],
};
const strict: ReviewProbe = {
  id: "strict-comma",
  basis: "requirement",
  quote: "With strict: true, a trailing comma throws a SyntaxError",
  program:
    "import { parse } from './index.js'; export default (text) => parse(text, { strict: true });",
  cases: [
    { input: "[1,]", throws: true },
    { input: "[1,2]", expected: [1, 2] },
  ],
};

describe("admitting a reviewer's probes", () => {
  it("runs a requirement probe only with the task's own words and an expectation per case", () => {
    const admitted = admitProbes(task, {
      probes: [
        strict,
        { ...strict, id: "invented", quote: "strict mode also sorts the keys" },
        { ...strict, id: "no-expectation", cases: [{ input: "[1,]" }] },
        { ...preserve, cases: [{ input: "[]", expected: "anything" }] },
        { id: "Bad Id", basis: "preserve", program: "./probes/bad.js", cases: [{ input: 1 }] },
        { ...preserve, id: "keepsDefaultParse" },
      ],
    });
    expect(admitted.probes.map((one) => one.id)).toEqual([
      "strict-comma",
      "default-parse",
      "keeps-default-parse",
    ]);
    expect(admitted.dropped).toEqual([
      { id: "invented", reason: "a requirement probe must quote the task's own words" },
      {
        id: "no-expectation",
        reason: "a requirement case needs an expected answer or throws: true",
      },
      {
        id: "bad-id",
        reason:
          "the program must be the source text of an ES module with a default export, not a path or a description",
      },
    ]);
  });

  it("keeps at most four objections, each with a scenario and an expectation", () => {
    expect(
      admitObjections({
        objections: [
          { scenario: "parse('[1,]')", expected: "unchanged" },
          { scenario: "no expectation" },
          ...Array.from({ length: 5 }, (_, index) => ({ scenario: `s${index}`, expected: "e" })),
        ],
      }),
    ).toHaveLength(4);
  });
});

describe("reading the runner's lines", () => {
  it("reads one answer per case and refuses anything else", () => {
    expect(readAnswers('{"input":1,"result":[2,1]}\n{"input":2,"threw":true}\n', 2)).toEqual([
      { kind: "result", text: "[2,1]" },
      { kind: "threw", inProgram: false },
    ]);
    expect(readAnswers('{"input":1,"result":{"b":1,"a":2}}\n', 1)).toEqual([
      { kind: "result", text: '{"a":2,"b":1}' },
    ]);
    expect(readAnswers('{"input":1,"threw":true,"thrownIn":"check-program"}\n', 1)).toEqual([
      { kind: "threw", inProgram: true },
    ]);
    expect(readAnswers("printed\n", 1)).toBeNull();
    expect(readAnswers('{"input":1,"result":1}\n', 2)).toBeNull();
  });
});

describe("what a probe's cases establish", () => {
  it("reads a preservation case against the base's observed answer", () => {
    const classified = classifyProbe(
      preserve,
      twice(answered("[1,2]", "[1]")),
      twice(answered("[1,2]", "threw")),
    );
    expect(classified.map((one) => [one.reading, one.role])).toEqual([
      ["kept", "kept"],
      ["preservation-regression", "kept"],
    ]);
    expect(classified[1]?.base).toBe("[1]");
    expect(classified[1]?.candidate).toBe('{"threw":true}');
  });

  it("reads a requirement case against the reviewer's expectation, and the base where it agrees", () => {
    const classified = classifyProbe(
      strict,
      twice(answered("[1]", "[1,2]")),
      twice(answered("[1]", "[1,2]")),
    );
    expect(classified.map((one) => [one.reading, one.role])).toEqual([
      ["missed-requirement", "requested"],
      ["met", "kept"],
    ]);
    const broken = classifyProbe(
      strict,
      twice(answered("[1]", "[1,2]")),
      twice(answered("threw", "[2]")),
    );
    expect(broken.map((one) => [one.reading, one.role])).toEqual([
      ["met", "requested"],
      ["preservation-regression", "kept"],
    ]);
  });

  it("establishes nothing where two runs disagree, the program raised, or nothing answered", () => {
    expect(
      classifyProbe(
        preserve,
        [answered("[1,2]", "[1]"), answered("[1,2]", "[2]")],
        twice(answered("[1,2]", "[1]")),
      ).map((one) => one.reading),
    ).toEqual(["kept", "unstable"]);
    expect(
      classifyProbe(preserve, twice(answered("raised", "[1]")), twice(answered("raised", "[1]")))[0]
        ?.reading,
    ).toBe("defective-program");
    expect(
      classifyProbe(
        preserve,
        twice({ kind: "did-not-load", detail: "SyntaxError" }),
        twice(answered("[1,2]", "[1]")),
      ).map((one) => [one.reading, one.role]),
    ).toEqual([
      ["did-not-load", null],
      ["did-not-load", null],
    ]);
  });
});

describe("the review's readings as ratchet parts", () => {
  it("holds kept cases as a part and the reviewer's requested cases as a claim", () => {
    const classified = [
      ...classifyProbe(
        preserve,
        twice(answered("[1,2]", "[1]")),
        twice(answered("[1,2]", "threw")),
      ),
      ...classifyProbe(strict, twice(answered("[1]", "[1,2]")), twice(answered("[1]", "[1,2]"))),
    ];
    expect(reviewParts(classified)).toEqual({
      parts: {
        "default-parse: kept": "failed",
        "strict-comma: requested": "failed",
        "strict-comma: kept": "passed",
      },
      claims: ["strict-comma: requested"],
    });
  });

  it("reads a later candidate under the roles the examination fixed, and fails a part that no longer answers", () => {
    const examined = classifyProbe(
      preserve,
      twice(answered("[1,2]", "[1]")),
      twice(answered("[1,2]", "threw")),
    );
    const repaired = remeasure(
      [preserve],
      examined,
      new Map([["default-parse", twice(answered("[1,2]", "[1]"))]]),
    );
    expect(reviewParts(repaired).parts).toEqual({ "default-parse: kept": "passed" });
    const broken = remeasure(
      [preserve],
      examined,
      new Map([["default-parse", twice({ kind: "did-not-load", detail: "x" })]]),
    );
    expect(reviewParts(broken).parts).toEqual({ "default-parse: kept": "failed" });
  });
});

describe("what the repair is told", () => {
  it("names each finding's basis, input, expectation and where the expectation comes from", () => {
    const findings = [
      ...classifyProbe(
        preserve,
        twice(answered("[1,2]", "[1]")),
        twice(answered("[1,2]", "threw")),
      ),
      ...classifyProbe(strict, twice(answered("[1]", "[1,2]")), twice(answered("[1]", "[1,2]"))),
    ].filter(
      (one) => one.reading === "preservation-regression" || one.reading === "missed-requirement",
    );
    const brief = findingsBrief({
      task,
      probes: [preserve, strict],
      findings,
      keepStatements: ["Without the option, parse() behaves as it does today."],
    });
    expect(brief).toContain(
      "Probe default-parse, case 2 (preservation-regression): existing behaviour (parse without options); the expected answer is the base's, as observed.",
    );
    expect(brief).toContain("  expected: [1]");
    expect(brief).toContain(
      "the reviewer's reading of the task's words \"With strict: true, a trailing comma throws a SyntaxError\"",
    );
    expect(brief).toContain("leave the code as it is and say which");
    expect(brief).toContain("Without the option, parse() behaves as it does today.");
  });

  it("gives the prose control's objections as claims nothing has run", () => {
    const brief = objectionsBrief({
      objections: [{ scenario: "parse('[1,]')", expected: "returns [1] as before" }],
      keepStatements: [],
    });
    expect(brief).toContain("nothing has run them");
    expect(brief).toContain("1. parse('[1,]')");
  });
});

describe("the review's probes as preservation obligations", () => {
  it("keeps only cases that hold behaviour the base showed", () => {
    const classified = [
      ...classifyProbe(preserve, twice(answered("[1,2]", "[1]")), twice(answered("[1,2]", "[1]"))),
      ...classifyProbe(strict, twice(answered("[2]", "[3]")), twice(answered("[1]", "[1,2]"))),
    ];
    expect(probeObligations({ probes: [preserve, strict], classified })).toEqual([
      {
        probe: "default-parse",
        statement: "parse without options",
        quote: null,
        readings: ["kept", "kept"],
      },
    ]);
  });
});
