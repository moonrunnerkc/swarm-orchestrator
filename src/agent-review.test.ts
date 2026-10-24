import { describe, expect, it } from "vitest";
import {
  admitObjections,
  admitProbes,
  authorityOf,
  type CaseAnswer,
  classifyProbe,
  establishedReadings,
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

const keep = {
  id: "task-keep-1",
  statement: "Without the option, parse() behaves as it does today.",
};
const guarded: ReviewProbe = { ...preserve, obligation: "task-keep-1" };

describe("what a probe's cases establish", () => {
  it("reads a difference under a stated obligation as a regression, and without one as a difference", () => {
    const classified = classifyProbe(
      guarded,
      twice(answered("[1,2]", "[1]")),
      twice(answered("[1,2]", '"[1]"')),
      keep,
    );
    expect(classified.map((one) => [one.reading, one.role, one.authority])).toEqual([
      ["kept", "kept", "task-keep-1"],
      ["preservation-regression", "kept", "task-keep-1"],
    ]);
    expect(classified[1]?.base).toBe("[1]");
    // The same answers with no obligation the task states: the task may have asked for it.
    expect(
      classifyProbe(
        preserve,
        twice(answered("[1,2]", "[1]")),
        twice(answered("[1,2]", '"[1]"')),
      ).map((one) => [one.reading, one.role]),
    ).toEqual([
      ["kept", null],
      ["difference", null],
    ]);
  });

  it("finds the authority a quote of the task's keep sentence names", () => {
    expect(authorityOf({ ...preserve, quote: "parse() behaves as it does today" }, [keep])).toEqual(
      keep,
    );
    expect(authorityOf({ ...preserve, quote: "a trailing comma throws" }, [keep])).toBeNull();
    expect(authorityOf({ ...preserve, obligation: "task-keep-9" }, [keep])).toBeNull();
  });

  it("reads a base that raised as the base lacking it, not as behaviour to keep (markdown-it, development launch 2)", () => {
    // The probe disabled a rule the task adds: the base threw for want of it, the candidate and
    // the reference answer. Under v1 the base's throw was the expectation and this was a finding.
    const classified = classifyProbe(
      { ...guarded, cases: [{ input: "[foo]: /url" }] },
      twice(answered("threw")),
      twice(answered('{"identical":true}')),
      keep,
    );
    expect(classified.map((one) => [one.reading, one.role])).toEqual([["base-raised", null]]);
  });

  it("keeps a requirement case the reviewer's reading, never a finding (svgo, development launch 1)", () => {
    // The reviewer expected true; the base, the candidate and the reference all answer false,
    // because its input spelled a tab as a backslash and a t.
    const whitespace: ReviewProbe = {
      ...strict,
      id: "whitespace-in-scheme",
      cases: [{ input: { value: "java\\tscript:alert(1)" }, expected: true }],
    };
    const classified = classifyProbe(
      whitespace,
      twice(answered("false")),
      twice(answered("false")),
    );
    expect(classified.map((one) => [one.reading, one.role])).toEqual([
      ["missed-requirement", null],
    ]);
    expect(establishedReadings.has("missed-requirement")).toBe(false);
    expect(
      classifyProbe(strict, twice(answered("[1]", "[1,2]")), twice(answered("[1]", "[1,2]"))).map(
        (one) => [one.reading, one.role],
      ),
    ).toEqual([
      ["missed-requirement", null],
      ["met", null],
    ]);
  });

  it("reads a probe the base answers and the candidate no longer loads as a regression only under a stated obligation and a runnable candidate", () => {
    const gone = twice({
      kind: "did-not-load",
      detail: "does not provide an export named parse",
    } as const);
    expect(
      classifyProbe(guarded, twice(answered("[1,2]", "[1]")), gone, keep).map((one) => [
        one.reading,
        one.role,
        one.base,
      ]),
    ).toEqual([
      ["preservation-regression", "kept", "[1,2]"],
      ["preservation-regression", "kept", "[1]"],
    ]);
    expect(
      classifyProbe(preserve, twice(answered("[1,2]", "[1]")), gone).map((one) => one.reading),
    ).toEqual(["difference", "difference"]);
    // A static check failed in a new way on the candidate, a build among them: the probe may be
    // reading output that was never built, so its silence is no finding.
    expect(
      classifyProbe(guarded, twice(answered("[1,2]", "[1]")), gone, keep, false).map((one) => [
        one.reading,
        one.role,
      ]),
    ).toEqual([
      ["did-not-load", null],
      ["did-not-load", null],
    ]);
  });

  it("keeps a preservation probe whose quote is not the task's words, without the quote", () => {
    const admitted = admitProbes(task, { probes: [{ ...preserve, quote: "e" }] });
    expect(admitted.probes).toHaveLength(1);
    expect(admitted.probes[0]?.quote).toBeUndefined();
    expect(admitted.dropped[0]?.reason).toContain("not the task's own words");
  });

  it("establishes nothing where two runs disagree, the program raised, or nothing answered", () => {
    expect(
      classifyProbe(
        guarded,
        [answered("[1,2]", "[1]"), answered("[1,2]", "[2]")],
        twice(answered("[1,2]", "[1]")),
        keep,
      ).map((one) => one.reading),
    ).toEqual(["kept", "unstable"]);
    expect(
      classifyProbe(
        guarded,
        twice(answered("raised", "[1]")),
        twice(answered("raised", "[1]")),
        keep,
      )[0]?.reading,
    ).toBe("defective-program");
    expect(
      classifyProbe(
        guarded,
        twice({ kind: "did-not-load", detail: "SyntaxError" }),
        twice(answered("[1,2]", "[1]")),
        keep,
      ).map((one) => [one.reading, one.role]),
    ).toEqual([
      ["did-not-load", null],
      ["did-not-load", null],
    ]);
  });
});

describe("the review's readings as ratchet parts", () => {
  it("holds only kept cases a stated obligation covers, and no claim", () => {
    const classified = [
      ...classifyProbe(
        guarded,
        twice(answered("[1,2]", "[1]")),
        twice(answered("[1,2]", "[2]")),
        keep,
      ),
      ...classifyProbe(
        { ...preserve, id: "unguarded" },
        twice(answered("[1,2]", "[1]")),
        twice(answered("[3]", "[1]")),
      ),
      ...classifyProbe(strict, twice(answered("[1]", "[1,2]")), twice(answered("[1]", "[1,2]"))),
    ];
    expect(reviewParts(classified)).toEqual({
      parts: { "default-parse: kept": "failed" },
      claims: [],
    });
  });

  it("reads a later candidate under the roles the examination fixed, and fails a part that no longer answers", () => {
    const examined = classifyProbe(
      guarded,
      twice(answered("[1,2]", "[1]")),
      twice(answered("[1,2]", "threw")),
      keep,
    );
    const repaired = remeasure(
      [guarded],
      examined,
      new Map([["default-parse", twice(answered("[1,2]", "[1]"))]]),
    );
    expect(reviewParts(repaired).parts).toEqual({ "default-parse: kept": "passed" });
    const broken = remeasure(
      [guarded],
      examined,
      new Map([["default-parse", twice({ kind: "did-not-load", detail: "x" })]]),
    );
    expect(reviewParts(broken).parts).toEqual({ "default-parse: kept": "failed" });
  });
});

describe("what the repair is told", () => {
  it("names each finding's authority, input, observed expectation, answer, program and candidate", () => {
    const findings = classifyProbe(
      guarded,
      twice(answered("[1,2]", "[1]")),
      twice(answered("[1,2]", "threw")),
      keep,
    ).filter((one) => establishedReadings.has(one.reading));
    const brief = findingsBrief({
      task,
      probes: [guarded],
      findings,
      authorities: [keep],
      candidate: "sha256:abc",
    });
    expect(brief).toContain(
      'Probe default-parse, case 2 (preservation-regression), under task-keep-1: "Without the option, parse() behaves as it does today.".',
    );
    expect(brief).toContain('  input: "[1,]"');
    expect(brief).toContain("  expected (the base's answer, observed): [1]");
    expect(brief).toContain('  your change gives: {"threw":true}');
    expect(brief).toContain("read on the candidate sha256:abc");
    expect(brief).toContain("Program of probe default-parse");
    expect(brief).toContain("say which sentence asks for it");
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
  it("keeps a preservation probe's cases with both trees' answers and the obligation it names", () => {
    const classified = [
      ...classifyProbe(
        guarded,
        twice(answered("[1,2]", "[1]")),
        twice(answered("[1,2]", "[1]")),
        keep,
      ),
      ...classifyProbe(strict, twice(answered("[2]", "[3]")), twice(answered("[1]", "[1,2]"))),
    ];
    expect(probeObligations({ probes: [guarded, strict], classified }, [keep])).toEqual([
      {
        probe: "default-parse",
        statement: "parse without options",
        quote: null,
        obligation: "task-keep-1",
        cases: [
          { index: 1, input: "[1,2]", base: "[1,2]", candidate: "[1,2]", reading: "kept" },
          { index: 2, input: "[1,]", base: "[1]", candidate: "[1]", reading: "kept" },
        ],
      },
    ]);
  });
});
