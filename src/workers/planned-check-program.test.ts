import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  declarationProblems,
  describeDeclaredCases,
  describeRelationRun,
  describeUncoveredSentences,
  type PlannedChecksDeclaration,
  plannedChecksInput,
  plannedContract,
  plannedRelation,
  plannedRelationInput,
  programDidNotLoad,
  programMisreadInput,
  relationAgreedSomewhere,
  relationText,
  sentencesQuoted,
  taskSentences,
  withPlannedCheck,
} from "./planned-check-program.ts";

/**
 * The checks the adapter builds, run by real Node the way the goal verifier runs them: the
 * harness's argv, the program and inputs on stdin, and the captured stdout compared with the one
 * expected text.
 */
let project = "";

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "swarm-planned-program-"));
  writeFileSync(
    join(project, "value.mjs"),
    "export function classify(n) {\n  if (typeof n !== 'number') throw new TypeError('not a number');\n  return { size: n < 10 ? 'small' : 'big', n };\n}\n",
  );
});

afterEach(() => rmSync(project, { recursive: true, force: true }));

const task = "every n up to and including 10 is small";

function built(check: Partial<PlannedChecksDeclaration["checks"][number]>) {
  const contract = plannedContract(
    task,
    {
      requirements: [{ id: "boundary", description: "10 is small", quote: task }],
      checks: [
        {
          id: "boundary",
          requirement: "boundary",
          purpose: "change",
          program:
            "import { classify } from './value.mjs';\nconsole.log('noise');\nexport default (n) => classify(n);\n",
          cases: [{ input: 3, expected: { n: 3, size: "small" } }],
          why: "w",
          ...check,
        },
      ],
    },
    undefined,
  );
  const [made] = contract.checks;
  if (made?.behavior?.kind !== "cli") throw new Error("a command-line check");
  return { check: made, behavior: made.behavior };
}

function run(made: ReturnType<typeof built>) {
  const [program, ...args] = made.behavior.argv;
  const ran = spawnSync(program ?? "node", args, {
    cwd: project,
    input: made.behavior.stdin,
    encoding: "utf8",
  });
  return {
    exitCode: ran.status,
    stdout: ran.stdout,
    stderr: ran.stderr,
    expected: made.behavior.stdout[0]?.value,
  };
}

describe("a planned check as the harness runs it", () => {
  it("prints one sorted JSON line per case, with what the program prints moved to stderr", () => {
    const ran = run(built({}));
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).toBe('{"input":3,"result":{"n":3,"size":"small"}}\n');
    expect(ran.stdout).toBe(ran.expected);
    expect(ran.stderr).toContain("noise");
    // The program was there only while it was imported.
    expect(readdirSync(project)).toEqual(["value.mjs"]);
  });

  it("reads a wrong answer as a completed run whose lines differ", () => {
    const ran = run(built({ cases: [{ input: 3, expected: { n: 3, size: "big" } }] }));
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).not.toBe(ran.expected);
  });

  it("records a thrown case as a result, and a declared throw as its expectation", () => {
    const ran = run(
      built({
        cases: [
          { input: "x", throws: true },
          { input: 12, expected: { n: 12, size: "big" } },
        ],
      }),
    );
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).toBe(ran.expected);
    expect(ran.stdout.split("\n")[0]).toBe('{"input":"x","threw":true}');
    expect(ran.stderr).toMatch(/case 1 threw: TypeError: not a number/);
  });

  it("reads undefined as null at every depth, as the tool's description says", () => {
    const ran = run(
      built({
        program: "export default () => undefined;\n",
        cases: [{ input: 1, expected: null }],
      }),
    );
    expect(ran.stdout).toBe(ran.expected);
    // A live planner returned { size: header.size } and expected { size: null } for an undefined
    // size; with the key dropped instead, its checks rejected every compliant implementation.
    const nested = run(
      built({
        program: "export default () => ({ size: undefined, list: [undefined] });\n",
        cases: [{ input: 1, expected: { size: null, list: [null] } }],
      }),
    );
    expect(nested.stdout).toBe(nested.expected);
  });

  it("exits with its own status when the program does not load, naming why", () => {
    const missing = run(
      built({
        program: "import { classify } from './dist/value.mjs';\nexport default classify;\n",
      }),
    );
    expect(missing.exitCode).toBe(programDidNotLoad);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toMatch(/did not load: .*ERR_MODULE_NOT_FOUND|Cannot find module/s);
    const syntax = run(built({ program: "export default (n) => classify(n;\n" }));
    expect(syntax.exitCode).toBe(programDidNotLoad);
    expect(syntax.stderr).toMatch(/did not load: SyntaxError/);
  });

  it("names a program that reads the case's fields off the input it was called with, and unwraps nothing", () => {
    // Launch 5: run(case_) returned mime.getType(case_.input) for string inputs, so every call
    // passed undefined. Read by property or by destructuring, the run says so and exits 4.
    for (const program of [
      "import { classify } from './value.mjs';\nexport default function run(case_) {\n  return classify(case_.input);\n}\n",
      "import { classify } from './value.mjs';\nexport default ({ input }) => classify(input);\n",
    ]) {
      const ran = run(built({ program, cases: [{ input: 3, expected: { n: 3, size: "small" } }] }));
      expect(ran.exitCode).toBe(programMisreadInput);
      // The case ran as written: the program's own answer is printed, not a rescued one.
      expect(ran.stdout).toBe('{"input":3,"threw":true}\n');
      expect(ran.stderr).toContain(
        "the program read .input of the value it was called with in case 1, but that value is the case's input itself, 3, a number, not the case",
      );
    }
  });

  it("leaves object inputs, their own input fields and the project's own reads alone", () => {
    writeFileSync(
      join(project, "value.mjs"),
      "export function classify(n) {\n  if (n.input !== undefined) return { size: 'odd', n };\n  return { size: n < 10 ? 'small' : 'big', n };\n}\n",
    );
    const objects = run(
      built({
        program:
          "import { classify } from './value.mjs';\nexport default (query) => classify(query.input);\n",
        cases: [{ input: { input: 3 }, expected: { n: 3, size: "small" } }],
      }),
    );
    expect(objects.exitCode).toBe(0);
    expect(objects.stdout).toBe(objects.expected);
    // The project reads .input of the number it is given; that read is the project's, not the program's.
    const own = run(built({ cases: [{ input: 3, expected: { n: 3, size: "small" } }] }));
    expect(own.exitCode).toBe(0);
    expect(own.stdout).toBe(own.expected);
  });
});

it("offers the model a tool schema that admits object inputs and results", () => {
  // z.json() rendered every object as closed to all properties, so a model following the
  // schema could pass only {} where a case needed { size, uid }.
  const rendered = z.toJSONSchema(plannedChecksInput, { io: "input" }) as unknown as {
    properties: { checks: { items: { properties: { cases: { items: { anyOf: unknown[] } } } } } };
  };
  const [valued] = rendered.properties.checks.items.properties.cases.items.anyOf as {
    properties: { input: object; expected: object };
  }[];
  expect(valued?.properties).toEqual({ input: {}, expected: {} });
  const parsed = plannedChecksInput.safeParse({
    requirements: [{ id: "a", description: "d" }],
    checks: [
      {
        id: "a",
        requirement: "a",
        purpose: "preserve",
        program: "export default (x) => x;",
        cases: [{ input: { record: "10 uid=-1\n" }, expected: { uid: -1, size: null } }],
        why: "w",
      },
    ],
  });
  expect(parsed.success).toBe(true);
});

describe("the task's sentences and what the planner's quotes cover", () => {
  // An excerpt of the node-tar development task's text, verbatim.
  const tar = Promise.resolve(
    "Refuse negative sizes in src/header.ts and src/pax.ts. In Pax.parse, a 'size' record is kept only when its numeric value is zero or greater: 'size=-1000' and a non-numeric value leave size undefined, while 'size=1000' gives 1000 and 'size=0' gives 0. Every other field (uid, gid, mode, the times and so on) keeps its current parsing, negative values included, and nothing else changes. Change only src/header.ts and src/pax.ts; do not edit tests.",
  );

  it("splits a task into its sentences without breaking at a dotted name", async () => {
    const sentences = taskSentences(await tar);
    expect(sentences.some((one) => one.startsWith("In Pax.parse, a 'size' record is kept"))).toBe(
      true,
    );
    expect(
      sentences.some((one) =>
        one.startsWith(
          "Every other field (uid, gid, mode, the times and so on) keeps its current parsing",
        ),
      ),
    ).toBe(true);
  });

  it("names the sentences no requirement quotes, and counts the ones quotes cover", async () => {
    const text = await tar;
    const declaration: PlannedChecksDeclaration = {
      requirements: [
        {
          id: "pax",
          description: "pax size",
          quote:
            "In Pax.parse, a 'size' record is kept only when its numeric value is zero or greater",
        },
      ],
      checks: [
        {
          id: "pax",
          requirement: "pax",
          purpose: "change",
          program: "export default (x) => x;",
          cases: [{ input: 1, expected: 1 }],
          why: "w",
        },
      ],
    };
    const listed = describeUncoveredSentences(text, declaration).join("\n");
    expect(listed).toMatch(/\[\d+\] Every other field \(uid, gid, mode/);
    expect(listed).not.toMatch(/\[\d+\] In Pax\.parse/);
    const index = taskSentences(text).findIndex((one) => one.startsWith("In Pax.parse")) + 1;
    expect(sentencesQuoted(text, ["In Pax.parse, a 'size' record is kept"])).toEqual([index]);
  });
});

describe("imports a program cannot load where it runs", () => {
  const repository = (files: readonly string[]) => ({
    root: "/repo",
    exists: (path: string) => files.includes(path),
  });
  const declaring = (program: string): PlannedChecksDeclaration => ({
    requirements: [{ id: "r", description: "d" }],
    checks: [
      {
        id: "c",
        requirement: "r",
        purpose: "preserve",
        program,
        cases: [{ input: 1, expected: 1 }],
        why: "w",
      },
    ],
  });

  it("refuses a path that leaves the repository and a .js path where only TypeScript exists", () => {
    const problems = declarationProblems(
      "t",
      declaring(
        "import { a } from '../dist/esm/a.js';\nimport b from './src/b.js';\nexport default () => 1;",
      ),
      undefined,
      repository(["/repo/src/b.ts"]),
    );
    expect(problems).toEqual([
      expect.stringMatching(/imports \.\.\/dist\/esm\/a\.js, which leaves the repository/),
      expect.stringMatching(
        /imports \.\/src\/b\.js, which does not exist; \.\/src\/b\.ts is TypeScript source/,
      ),
    ]);
  });

  it("refuses a program that loads nothing from the repository, which cannot observe the project", () => {
    // A constant can get one base case right and another wrong, which is all admission asks of a
    // change check, so the base control alone would have admitted it.
    for (const program of [
      "export default () => 'small';",
      "import assert from 'node:assert';\nexport default (n) => (assert.ok(n), 'small');",
    ])
      expect(declarationProblems("t", declaring(program), undefined, repository([]))).toEqual([
        expect.stringMatching(
          /imports nothing from the repository, so it cannot observe the project/,
        ),
      ]);
    // The repository's own package by name, or through require, is an import of the project.
    for (const program of [
      "import mime from 'mime';\nexport default (x) => mime.getType(x);",
      "const { a } = require('./lib/a.js');\nexport default a;",
    ])
      expect(declarationProblems("t", declaring(program), undefined, repository([]))).toEqual([]);
  });

  it("leaves build output that does not exist yet alone", () => {
    expect(
      declarationProblems(
        "t",
        declaring("import a from './dist/src/a.js';\nexport default () => a;"),
        undefined,
        repository(["/repo/src/a.ts"]),
      ),
    ).toEqual([]);
  });
});

/**
 * A development fixture, structurally unlike mime's path parsing: an assignment parser whose
 * task says a tab around the equals sign is ignored as a space already is. The faulty candidate
 * handles a leading tab and misses a trailing one, which an example at one position can pass.
 * These are development tests of the mechanism, not evidence it generalizes.
 */
describe("a planned relation as the harness runs it", () => {
  const sources = {
    base: "export const parse = (line) => { const [key, value = ''] = line.split('='); return { key: key.replace(/^ +| +$/g, ''), value: value.replace(/^ +| +$/g, '') }; };\n",
    faulty:
      "export const parse = (line) => { const [key, value = ''] = line.split('='); return { key: key.replace(/^[ \\t]+| +$/g, ''), value: value.replace(/^[ \\t]+| +$/g, '') }; };\n",
    correct:
      "export const parse = (line) => { const [key, value = ''] = line.split('='); return { key: key.replace(/^[ \\t]+|[ \\t]+$/g, ''), value: value.replace(/^[ \\t]+|[ \\t]+$/g, '') }; };\n",
  };
  const relationTask =
    "Treat a tab around the equals sign like a space: a space there is already ignored.";
  const declaration = withPlannedCheck(null, {
    id: "tab-like-space",
    purpose: "change",
    requirementId: "tab-around-equals",
    requirement: "a tab around = is ignored like a space",
    quote: "Treat a tab around the equals sign like a space",
    program: "import { parse } from './assign.mjs';\nexport default (line) => parse(line);\n",
    seeds: ["key=value"],
    reference: " ",
    variants: ["\t"],
    why: "the task says a tab is treated like a space",
  });
  const made = () => {
    const contract = plannedContract(relationTask, declaration, undefined);
    const [check] = contract.checks;
    if (check?.behavior?.kind !== "cli") throw new Error("a command-line check");
    return { check, behavior: check.behavior };
  };
  const runOn = (source: string) => {
    writeFileSync(join(project, "assign.mjs"), source);
    return run(made());
  };

  it("builds a check that carries the relation and expects every seed to hold, with its call count", () => {
    const { check, behavior } = made();
    expect(plannedRelation(check)).toEqual({
      seeds: ["key=value"],
      reference: " ",
      variants: ["\t"],
    });
    // Ten positions in a nine-character seed, the reference and one variant at each.
    expect(behavior.stdout[0]?.value).toBe('{"holds":true,"ran":20,"seed":"key=value"}\n');
    expect(check.command).toBe(
      'planned relation: " " and 1 variant(s) at every position of 1 seed(s), 20 call(s) through the default export of its program',
    );
    expect(describeDeclaredCases(declaration)[0]).toContain(
      'reference " "; variants "\\t"; 20 call(s)',
    );
  });

  it("finds the position the faulty candidate misses and returns the smallest case with both answers", () => {
    const ran = runOn(sources.faulty);
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).not.toBe(ran.expected);
    const [line] = ran.stdout
      .trim()
      .split("\n")
      .map((one) => JSON.parse(one));
    expect(line).toMatchObject({ holds: false, ran: 20, seed: "key=value" });
    // A tab just before the equals sign, and just after the value: the trailing positions.
    expect(line.counterexamples[0]).toEqual({
      at: 3,
      reference: { input: "key =value", result: { key: "key", value: "value" } },
      variant: { input: "key\t=value", result: { key: "key\t", value: "value" } },
    });
    expect(line.disagreements).toBe(2);
    // As the worker reads it: the seed, how much of it broke, and the case with both answers.
    const relation = plannedRelation(made().check);
    if (relation === null) throw new Error("a relation");
    expect(describeRelationRun(relation, ran.stdout)).toEqual([
      'seed "key=value": 2 of 10 comparisons disagreed',
      '  at position 3: "key\\t=value" gave {"key":"key\\t","value":"value"}, where "key =value" gave {"key":"key","value":"value"}',
      '  at position 9: "key=value\\t" gave {"key":"key","value":"value\\t"}, where "key=value " gave {"key":"key","value":"value"}',
    ]);
  });

  it("holds on the correct implementation, including where the result carries the inserted text", () => {
    // "ke\ty" is a key with a tab inside it, which the task leaves alone: read under the
    // substitution it is "ke y", what the reference gives, so a correct parser holds.
    const ran = runOn(sources.correct);
    expect(ran.stdout).toBe(ran.expected);
  });

  it("is admitted against the base by a position the base already treats alike", () => {
    const ran = runOn(sources.base);
    expect(ran.stdout).not.toBe(ran.expected);
    const relation = plannedRelation(made().check);
    if (relation === null) throw new Error("a relation");
    // Inside the key and the value a tab already reads like a space; at their edges it does not.
    expect(relationAgreedSomewhere(relation, ran.stdout)).toBe(true);
    // A program that reports which text it was given disagrees everywhere: no control.
    expect(
      relationAgreedSomewhere(
        relation,
        '{"counterexamples":[],"disagreements":10,"holds":false,"ran":20,"seed":"key=value"}\n',
      ),
    ).toBe(false);
  });

  it("reads whitespace written as code points, which a local tool channel cannot carry as itself", () => {
    // Launch 3: eleven calls whose reference was a space and whose variants were line terminators
    // arrived as "" and [], because the server's tool-call parser trims a whitespace-only value.
    expect(relationText("U+0020")).toBe(" ");
    expect(relationText("U+000D U+000A")).toBe("\r\n");
    expect(relationText(" ")).toBe(" ");
    expect(relationText("U+")).toBe("U+");
    const declared = withPlannedCheck(null, {
      id: "terminator-like-space",
      purpose: "change",
      requirementId: "terminators",
      requirement: "a line terminator behaves like a space",
      quote: "Treat a tab around the equals sign like a space",
      program: "import { parse } from './assign.mjs';\nexport default (line) => parse(line);\n",
      seeds: ["key=value"],
      reference: "U+0020",
      variants: ["U+0009", "U+000A"],
      why: "w",
    });
    expect(declared.checks[0]?.relation).toEqual({
      seeds: ["key=value"],
      reference: " ",
      variants: ["\t", "\n"],
    });
    // What the planner is told when it arrives empty, or as a whole input.
    const refused = plannedRelationInput.safeParse({
      ...declared.checks[0],
      requirementId: "terminators",
      requirement: "r",
      quote: "q",
      seeds: ["key=value"],
      reference: "",
      variants: ["LINE\nFEED.png and more than thirty-two characters"],
    });
    expect(refused.success).toBe(false);
    const messages = refused.error?.issues.map((issue) => issue.message).join(" | ") ?? "";
    expect(messages).toContain("U+0020 for a space");
    expect(messages).toContain("not a whole input");
  });

  it("refuses a relation that compares the reference with itself, or repeats a seed", () => {
    const problems = (relation: { seeds: string[]; reference: string; variants: string[] }) =>
      declarationProblems(
        relationTask,
        { ...declaration, checks: declaration.checks.map((one) => ({ ...one, relation })) },
        undefined,
      );
    expect(problems({ seeds: ["a"], reference: " ", variants: [" ", "\t"] }).join()).toContain(
      "a variant equals the reference",
    );
    expect(problems({ seeds: ["a", "a"], reference: " ", variants: ["\t"] }).join()).toContain(
      "a seed is listed twice",
    );
    expect(problems({ seeds: ["a=b"], reference: " ", variants: ["\t"] })).toEqual([]);
  });
});
