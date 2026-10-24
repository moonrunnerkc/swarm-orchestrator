import { describe, expect, it } from "vitest";
import {
  admitObjections,
  admitProbes,
  authorityOf,
  type CaseAnswer,
  classifyProbe,
  classifyRelation,
  classifyTaskExamples,
  establishedReadings,
  findingsBrief,
  objectionsBrief,
  type ProbeRun,
  probeObligations,
  type ReviewProbe,
  readAnswers,
  remeasure,
  reviewParts,
  taskProbes,
} from "./agent-review.ts";
import { taskCodeStatements } from "./task-code-statements.ts";

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

  it("reads an optional field sent as null as not given, as two live probes sent it", () => {
    const admitted = admitProbes(task, {
      probes: [{ ...preserve, keeps: null, obligation: null, quote: null }],
    });
    expect(admitted.dropped).toEqual([]);
    expect(admitted.probes[0]).not.toHaveProperty("keeps");
  });

  it("renames an id the credential scrubber would redact, and runs no program it would redact", () => {
    // A program the recorder leaves whole is kept, though a plain text scan would flag it.
    const tokens = admitProbes(task, {
      probes: [
        {
          ...preserve,
          program:
            "import { parse } from './index.js';\nexport default (text) => { const tokens = parse(text); return tokens; };",
        },
      ],
    });
    expect(tokens.probes.map((one) => one.id)).toEqual(["default-parse"]);
    // The reviewer's id of October 24, whose "sk-" run the scrubber read as an API key: the
    // recorded probe contract then no longer matched its digest, and the bundle failed to verify.
    const admitted = admitProbes(task, {
      probes: [
        {
          ...preserve,
          id: "preserves-task-keep-1-with-query-behaviour",
          obligation: "task-keep-1",
        },
        {
          ...preserve,
          id: "carries-a-key",
          program: `export default () => "sk-${"a".repeat(24)}";`,
        },
      ],
    });
    expect(admitted.probes.map((one) => one.id)).toEqual(["probe-1"]);
    expect(admitted.dropped).toEqual([
      {
        id: "carries-a-key",
        reason:
          "its program or inputs carry text the evidence scrubber redacts as a credential, so the record of what ran could not be held to what ran",
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

describe("requested behaviour the task states (task-code-v1, relations)", () => {
  const loader = {
    rule: "project-loader-v1" as const,
    entry: "./query.mjs",
    method: "native" as const,
    entries: [{ entry: "./query.mjs", method: "native" as const }],
    preamble: 'const project = await import("./query.mjs");',
    exports: ["parse", "rebuild"],
  };
  const statements = taskCodeStatements(
    'Add drop(input, keep). drop(input, () => true) equals rebuild(input, {}) for every input that contains "?". drop("/a?x=1", (key) => key !== "x") is "/a"; keep(key, value) returns true; rebuild("/b?y", {}) stays "/b?y". Today rebuild("/c", {}) returns "/c".',
  );
  const probes = taskProbes(statements, loader);
  /** The relation over its first two inputs, the task's own and one carried into its domain. */
  const relationOf = (): ReviewProbe => {
    const whole = probes[2] as ReviewProbe;
    return {
      ...whole,
      cases: [{ input: "/a?x=1" }, { input: "file:///C:/x?x=1" }],
      statements: (whole.statements ?? []).slice(0, 2),
    };
  };

  it("builds one probe of the requested examples, one of the kept, and one per relation", () => {
    expect(probes.map((one) => [one.id, one.basis, one.cases.length])).toEqual([
      ["code-requested", "requirement", 1],
      ["code-kept", "preserve", 1],
      ["code-relation-1", "relation", 4],
    ]);
    // A name the project does not export is the candidate's answer, not a broken probe.
    expect(probes[0]?.program).toContain(
      'if (typeof drop !== "function") return { "not a function of the project": "drop" };',
    );
    expect(probes[2]?.reference).toContain("rebuild(input, {})");
  });

  it("holds a requested example to the task's literal, and a kept one first to the base", () => {
    const requested = probes[0] as ReviewProbe;
    expect(
      classifyTaskExamples(
        requested,
        twice(answered('{"not a function":1}')),
        twice(answered('"/a?x=1"')),
      ).map((one) => [one.reading, one.expected, one.authority]),
    ).toEqual([["requested-unmet", '"/a"', "code-example-1"]]);
    expect(
      classifyTaskExamples(requested, twice(answered("1")), twice(answered('"/a"'))).map(
        (one) => one.reading,
      ),
    ).toEqual(["met"]);
    const kept = probes[1] as ReviewProbe;
    expect(
      classifyTaskExamples(kept, twice(answered('"/b?y"')), twice(answered('"/b?y="'))).map(
        (one) => one.reading,
      ),
    ).toEqual(["preservation-regression"]);
    // The base does not give what the task says it keeps: the sentence may be misread.
    expect(
      classifyTaskExamples(kept, twice(answered('"/b"')), twice(answered('"/b"'))).map(
        (one) => one.reading,
      ),
    ).toEqual(["provisional"]);
    // A function no loaded entry exposes may live in a module no probe loaded: not judged.
    expect(
      classifyTaskExamples(
        requested,
        twice(answered("1")),
        twice(answered('{"not a function of the project":"drop"}')),
      ).map((one) => one.reading),
    ).toEqual(["provisional"]);
    expect(establishedReadings.has("requested-unmet")).toBe(true);
    expect(establishedReadings.has("provisional")).toBe(false);
  });

  it("establishes a relation's difference only where its reading is supported", () => {
    const relation = relationOf();
    const onBase = twice(answered('"/a?x=1"', '"file://C:/x?x=1"'));
    const verbatim = twice(answered('"/a?x=1"', '"file:///C:/x?x=1"'));
    expect(classifyRelation(relation, onBase, verbatim).map((one) => one.reading)).toEqual([
      "related",
      "relation-violated",
    ]);
    // A reviewer's relation that agrees nowhere is its own reading.
    const { origin: _origin, ...unowned } = relation;
    const reviewers: ReviewProbe = { ...unowned, id: "mine" };
    expect(
      classifyRelation(reviewers, onBase, twice(answered('"x"', '"y"'))).map((one) => one.reading),
    ).toEqual(["relation-unconfirmed", "relation-unconfirmed"]);
    // A domain the reader could not follow leaves every difference provisional.
    expect(
      classifyRelation({ ...relation, provisional: "unfollowed" }, onBase, verbatim).map(
        (one) => one.reading,
      ),
    ).toEqual(["related", "relation-unconfirmed"]);
  });

  it("holds a requested case to its expectation on a later candidate", () => {
    const relation = relationOf();
    const examined = classifyRelation(
      relation,
      twice(answered('"/a?x=1"', '"file://C:/x?x=1"')),
      twice(answered('"/a?x=1"', '"file:///C:/x?x=1"')),
    );
    expect(reviewParts(examined).parts).toEqual({ "code-relation-1: requested": "failed" });
    const repaired = remeasure(
      [relation],
      examined,
      new Map([[relation.id, twice(answered('"/a?x=1"', '"file://C:/x?x=1"'))]]),
    );
    expect(repaired.map((one) => one.reading)).toEqual(["related", "related"]);
    expect(reviewParts(repaired).parts).toEqual({ "code-relation-1: requested": "passed" });
  });

  it("admits a reviewer's relation only with the task's words and a reference to functions they name", () => {
    const quote = "keep is called once for each key of parse(input), in that order";
    const relationTask = `Add drop(input, keep). ${quote}.`;
    const base = {
      id: "calls",
      basis: "relation",
      quote,
      program: "export default () => 1;",
      cases: [{ input: "/a" }],
    };
    const admitted = admitProbes(relationTask, {
      probes: [
        { ...base, reference: "export default (input) => Object.entries(project.parse(input));" },
        {
          ...base,
          id: "unnamed",
          reference: "export default (input) => project.rebuild(input, {});",
        },
        { ...base, id: "nothing", reference: "export default () => [];" },
        {
          ...base,
          id: "unquoted",
          quote: "keep is called twice for each key",
          reference: "export default (i) => project.parse(i);",
        },
      ],
    });
    expect(admitted.probes.map((one) => one.id)).toEqual(["calls"]);
    expect(admitted.dropped.map((one) => [one.id, one.reason])).toEqual([
      ["unnamed", "the reference calls rebuild, which the quoted words do not name"],
      [
        "nothing",
        "a relation's reference must call the project's existing functions as project.<name>",
      ],
      ["unquoted", "a relation probe must quote the task's own words"],
    ]);
  });

  it("renames or refuses a probe whose recorded strings the scrubber would redact, check ids included", () => {
    // Alone the id passes; its check ids (`mask-parse-call-ref-run-1`) carry sixteen characters
    // after `sk-`, which the record's scrubber redacts.
    const admitted = admitProbes("Keep parse(input) as it is. parse(input) must not change.", {
      probes: [
        {
          id: "mask-parse-call",
          basis: "relation",
          quote: "Keep parse(input) as it is",
          program: "export default () => 1;",
          reference: "export default (input) => project.parse(input);",
          cases: [{ input: "/a" }],
        },
      ],
    });
    expect(admitted.probes.map((one) => one.id)).toEqual(["probe-1"]);
  });
});
