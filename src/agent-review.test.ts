import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  admitObjections,
  admitProbes,
  authorityOf,
  type CaseAnswer,
  classifyProbe,
  classifyRelation,
  classifyTaskExamples,
  createCandidateReview,
  establishedReadings,
  findingsBrief,
  heldBackProbes,
  objectionsBrief,
  type ProbeRun,
  probeObligations,
  type ReviewProbe,
  readAnswers,
  remeasure,
  reviewParts,
  statedGaps,
  taskProbes,
  validatedViolations,
} from "./agent-review.ts";
import { createTestClock } from "./core/test-doubles.ts";
import { openEvidenceSession } from "./evidence/session.ts";
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
      parts: { "default-parse#1: kept": "passed", "default-parse#2: kept": "failed" },
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
    expect(reviewParts(repaired).parts).toEqual({
      "default-parse#1: kept": "passed",
      "default-parse#2: kept": "passed",
    });
    const broken = remeasure(
      [guarded],
      examined,
      new Map([["default-parse", twice({ kind: "did-not-load", detail: "x" })]]),
    );
    expect(reviewParts(broken).parts).toEqual({
      "default-parse#1: kept": "failed",
      "default-parse#2: kept": "failed",
    });
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
    expect(reviewParts(examined).parts).toEqual({
      "code-relation-1#1: requested": "passed",
      "code-relation-1#2: requested": "failed",
    });
    const repaired = remeasure(
      [relation],
      examined,
      new Map([[relation.id, twice(answered('"/a?x=1"', '"file://C:/x?x=1"'))]]),
    );
    expect(repaired.map((one) => one.reading)).toEqual(["related", "related"]);
    expect(reviewParts(repaired).parts).toEqual({
      "code-relation-1#1: requested": "passed",
      "code-relation-1#2: requested": "passed",
    });
    // A repair that fixes the open case and breaks the held one moves a part the wrong way, which
    // one part per probe (failed on both sides) read as no change.
    const traded = remeasure(
      [relation],
      examined,
      new Map([[relation.id, twice(answered('"/a"', '"file://C:/x?x=1"'))]]),
    );
    expect(reviewParts(traded).parts).toEqual({
      "code-relation-1#1: requested": "failed",
      "code-relation-1#2: requested": "passed",
    });
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

describe("the grounded path (candidate-review-v4)", () => {
  const enumerationTask =
    'Add pick(input: string, keep: (key: string, value: string) => boolean): string. Otherwise keep is called once for each key of entries(input), in that order, with the key and its value, and pick(input, () => true) equals rebuild(input) for every input that contains "?". Examples: pick("/a?k=1&j=2", (key) => key === "k") is "/a?k=1" and pick("/b", () => false) is "/b".';
  const statements = taskCodeStatements(enumerationTask);
  const loaderAt = (url: string) => ({
    rule: "project-loader-v1" as const,
    entry: "./query.mjs",
    method: "native" as const,
    entries: [{ entry: "./query.mjs", method: "native" as const }],
    preamble: `const project = await import(${JSON.stringify(url)});`,
    exports: ["entries", "pick", "rebuild"],
  });
  // A project module: `entries` lists a query's keys, and `pick` asks `keep` about them, either
  // once per key or, like the October 24 candidate, once more about the first kept key.
  const project = (twice: boolean) =>
    [
      "export const entries = (input) => {",
      '  const out = {}; const at = input.indexOf("?"); if (at < 0) return out;',
      '  for (const part of input.slice(at + 1).split("&")) { if (part === "") continue; const [key, value = ""] = part.split("="); out[key] = value; }',
      "  return out;",
      "};",
      "export const rebuild = (input) => input;",
      "export const pick = (input, keep) => {",
      "  const found = entries(input);",
      twice ? "  for (const key of Object.keys(found)) if (keep(key, found[key])) break;" : "",
      "  for (const key of Object.keys(found)) keep(key, found[key]);",
      "  return input;",
      "};",
    ].join("\n");

  async function answersOf(directory: string, program: string, inputs: readonly unknown[]) {
    const { writeFile } = await import("node:fs/promises");
    const { pathToFileURL } = await import("node:url");
    const file = join(directory, `probe-${Math.random().toString(36).slice(2)}.mjs`);
    await writeFile(file, program);
    const run = (await import(pathToFileURL(file).href)).default as (input: unknown) => unknown;
    return Promise.all(inputs.map(async (input) => JSON.stringify(await run(input))));
  }

  it("runs an enumeration: a callback asked twice about one key is a counterexample, once per key is not", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { pathToFileURL } = await import("node:url");
    const read = (twice: boolean) => async () => {
      const directory = await mkdtemp(join(tmpdir(), "swarm-enumeration-"));
      await writeFile(join(directory, "query.mjs"), project(twice));
      const loader = loaderAt(pathToFileURL(join(directory, "query.mjs")).href);
      const probe = taskProbes(statements, loader, true).find(
        (one) => one.id === "code-enumeration-1",
      ) as ReviewProbe;
      const inputs = probe.cases.map((one) => one.input);
      return {
        probe,
        subject: await answersOf(directory, probe.program, inputs),
        reference: await answersOf(directory, probe.reference as string, inputs),
      };
    };
    const asked = await read(true)();
    expect(asked.probe.origins?.[0]).toBe("task");
    expect(asked.probe.cases[0]?.input).toBe("/a?k=1&j=2");
    expect(asked.subject[0]).toBe('[["k","1"],["k","1"],["j","2"]]');
    expect(asked.reference[0]).toBe('[["k","1"],["j","2"]]');
    const fixed = await read(false)();
    expect(fixed.subject).toEqual(fixed.reference);
  });

  it("keeps the validation batch apart, under its own id, and lists only the sentences no statement comes from as gaps", () => {
    const loader = loaderAt("file:///nowhere/query.mjs");
    const probes = taskProbes(statements, loader, true);
    const held = heldBackProbes(probes, statements);
    expect(held.map((one) => one.id)).toEqual(["code-relation-1-held", "code-enumeration-1-held"]);
    for (const probe of held) {
      const visible = probes.find((one) => `${one.id}-held` === probe.id) as ReviewProbe;
      expect(probe.origins?.every((one) => one === "validation")).toBe(true);
      for (const one of probe.cases)
        expect(visible.cases.map((known) => known.input)).not.toContain(one.input);
    }
    expect(statedGaps(enumerationTask, statements)).toEqual([
      "Add pick(input: string, keep: (key: string, value: string) => boolean): string.",
    ]);
  });

  it("counts as a validated violation only an established case of the task's own supported code", () => {
    const loader = loaderAt("file:///nowhere/query.mjs");
    const enumeration = taskProbes(statements, loader, true).find(
      (one) => one.id === "code-enumeration-1",
    ) as ReviewProbe;
    const violated = classifyRelation(
      { ...enumeration, cases: [{ input: "/a?k=1" }] },
      twice(answered('[["k","1"]]')),
      twice(answered('[["k","1"],["k","1"]]')),
    );
    expect(violated.map((one) => one.reading)).toEqual(["relation-violated"]);
    expect(validatedViolations([enumeration], violated)).toHaveLength(1);
    // The same difference under a provisional reading, or from a reviewer's probe, decides nothing.
    expect(validatedViolations([{ ...enumeration, provisional: "unfollowed" }], violated)).toEqual(
      [],
    );
    const { origin: _origin, ...reviewers } = enumeration;
    expect(validatedViolations([reviewers], violated)).toEqual([]);
  });

  it("examines without a reviewer, holds the validation batch back until a repaired candidate is kept, then exposes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "swarm-grounded-"));
    const evidence = await openEvidenceSession({
      root,
      sessionId: "grounded",
      clock: createTestClock(1_700_000_000_000),
    });
    const loader = loaderAt("file:///nowhere/query.mjs");
    const held = heldBackProbes(taskProbes(statements, loader, true), statements);
    const heldInput = held.find((one) => one.id === "code-enumeration-1-held")?.cases[0]
      ?.input as string;
    // The candidate under review: asks twice everywhere (v0), then once except on one input of the
    // held batch (v1), then once everywhere (v2).
    let version = 0;
    const entriesOf = (input: string) => {
      const out: [string, string][] = [];
      const at = input.indexOf("?");
      if (at < 0) return out;
      for (const part of input.slice(at + 1).split("&")) {
        if (part === "") continue;
        const [key, value = ""] = part.split("=");
        if (!out.some(([known]) => known === key)) out.push([key as string, value]);
      }
      return out;
    };
    const answer = (probe: ReviewProbe, input: unknown, tree: "base" | "candidate") => {
      const text = String(input);
      if (probe.id.endsWith("-ref"))
        return probe.id.includes("enumeration") ? entriesOf(text) : text;
      if (probe.id.startsWith("code-relation")) return text;
      if (probe.id.startsWith("code-enumeration")) {
        const once = entriesOf(text);
        const doubled =
          tree === "candidate" && (version === 0 || (version === 1 && text === heldInput));
        return doubled && once.length > 0 ? [once[0], ...once] : once;
      }
      // The task's two examples, by their index: each answered as the task states on the candidate.
      return tree === "base"
        ? { "not a function of the project": "pick" }
        : (["/a?k=1", "/b"][Number(input)] ?? null);
    };
    const runProbes = async (probes: readonly ReviewProbe[], tree: "base" | "candidate") => ({
      runs: new Map(
        probes.map((probe) => [
          probe.id,
          twice({
            kind: "answered",
            answers: probe.cases.map((one) => ({
              kind: "result" as const,
              text: JSON.stringify(answer(probe, one.input, tree)),
            })),
          }),
        ]),
      ),
      records: [],
    });
    const review = createCandidateReview({
      mode: "grounded",
      task: enumerationTask,
      evidence,
      clock: createTestClock(1_700_000_000_000),
      runProbes,
      diff: async () => `diff for version ${version}`,
      obligations: [],
      authorities: [],
      runLoop: () => {
        throw new Error("the grounded path asked a reviewer");
      },
      loopDependencies: { maxOutputTokens: 1000 } as never,
      readOnly: () => {
        throw new Error("the grounded path opened the reviewer's tools");
      },
      remaining: () => ({ tokens: 0, wallMs: 600_000 }),
      charge: async () => {
        throw new Error("the grounded path charged a conversation");
      },
      grounding: async () => ({ loader, attempts: [], statements }),
    });
    const examination = await review.examine({ statuses: {}, runs: [] });
    expect(examination.brief).toContain("expected calls (one per entry");
    expect(examination.open.length).toBeGreaterThan(0);
    // v1: every visible case holds, and the held batch shows the one input it was kept back for.
    version = 1;
    const repaired = await review.measure();
    expect(repaired.exposed).toEqual([expect.stringContaining(JSON.stringify(heldInput))]);
    expect(repaired.violations).toEqual(repaired.exposed);
    expect(repaired.brief).toContain("held back from it");
    expect(Object.keys(repaired.parts).some((part) => part.includes("-held"))).toBe(false);
    review.adopt();
    expect(review.readings().probes.some((one) => one.id.endsWith("-held"))).toBe(true);
    // v2: the exposed case is now held like the others, and holds.
    version = 2;
    const finished = await review.measure();
    expect(finished.violations).toEqual([]);
    expect(Object.keys(finished.parts).some((part) => part.includes("-held"))).toBe(true);
    const examined = evidence
      .records()
      .map(
        (entry) =>
          evidence.payloads().get(entry.payloadDigest) as { phase?: string; reviewer?: unknown },
      )
      .find((payload) => payload?.phase === "examined");
    expect(examined?.reviewer).toEqual({
      asked: false,
      reason: "grounded mode: the harness's own checks only",
      gaps: [],
    });
    await rm(root, { recursive: true, force: true });
  });
});
