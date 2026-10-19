import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { admitPlannedChecks } from "./cli-planned-checks.ts";
import { createTestClock } from "./core/test-doubles.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
import { plannedCheckProbe, plannedContract } from "./workers/planned-check-program.ts";

/**
 * Admission over the classifier example: the task moves 10 to "small" and keeps everything above
 * it "big"; the base calls n < 10 small. The base run is simulated from that rule, so what each
 * check would print on the real base is what admission reads.
 */
const task = "Change classify so 10 is small. Values above 10 remain big.";
const atBase = (n: number) => (n < 10 ? "small" : "big");

let root = "";
let evidence: EvidenceRecorder;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-admission-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "planning",
    clock: createTestClock(1_700_000_000_000),
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const supplied = freezeGoalContract({
  version: 1,
  goal: task,
  requirements: [{ id: "suite", description: "the suite passes", checks: ["suite"] }],
  checks: [
    { id: "suite", command: "node --test", author: "user", exposure: "shared", artifacts: [] },
  ],
  immutablePaths: [],
}).contract;

const program = "import { classify } from './value.mjs';\nexport default classify;\n";
/** A planned check over classify; a change check's cases are marked changed where the base differs. */
const check = (
  id: string,
  requirement: string,
  purpose: "change" | "preserve",
  cases: readonly [unknown, unknown][],
  why = "from the task",
  over = program,
) => ({
  id,
  requirement,
  purpose,
  program: over,
  cases: cases.map(([input, expected]) => ({
    input,
    expected,
    ...(purpose === "change"
      ? { changed: typeof input !== "number" || expected !== atBase(input) }
      : {}),
  })),
  why,
});

interface SimulatedRun {
  /** What the program answers each input on the base. */
  readonly answer: (input: unknown) => unknown;
  readonly exitCode?: number;
  /** Whether the argument probe sees the program read .input off a primitive input. */
  readonly misreads?: boolean;
}

/**
 * Records what each planned check prints on the base, as the verifier's base run would, and what
 * each argument probe prints beside it. A check with no run of its own answers by the base rule.
 */
function simulate(runs: Readonly<Record<string, SimulatedRun>> = {}) {
  const ordinary: SimulatedRun = { answer: (n) => atBase(n as number) };
  return async (contract: GoalContract) => {
    for (const one of contract.checks) {
      if (one.behavior?.kind !== "cli") continue;
      const { inputs } = JSON.parse(one.behavior.stdin) as { inputs: unknown[] };
      const probing = one.behavior.argv[3] === plannedCheckProbe;
      const of = probing ? one.command.replace("argument probe of planned check ", "") : one.id;
      const ran = runs[of] ?? ordinary;
      const exitCode = ran.exitCode ?? 0;
      const stdout = probing
        ? `${JSON.stringify({
            calls: inputs.length,
            misread:
              ran.misreads === true
                ? inputs.map((input, index) => ({
                    label: `case ${index + 1}`,
                    field: "input",
                    input,
                  }))
                : [],
          })}\n`
        : exitCode === 0
          ? inputs.map((n) => `${JSON.stringify({ input: n, result: ran.answer(n) })}\n`).join("")
          : "";
      await evidence.record({
        type: "goal-check",
        actor: "harness",
        provenance: ["tool-output"],
        payload: asJsonValue({
          phase: "completed",
          checkId: one.id,
          status:
            probing || (exitCode === 0 && stdout === one.behavior.stdout[0]?.value)
              ? "accepted"
              : "rejected",
          behavior: { exitCode: 0 },
          observation: {
            exitCode: probing && exitCode !== 3 ? 0 : exitCode,
            unavailable: null,
            outputTruncated: false,
            stdout,
            stderr: exitCode === 3 ? "the check program did not load" : "",
          },
        }),
      });
    }
  };
}

/** The base run with these checks' programs failing to load. */
const baseRun = (broken: ReadonlySet<string> = new Set()) =>
  simulate(Object.fromEntries([...broken].map((id) => [id, { answer: () => null, exitCode: 3 }])));

describe("admitting planned checks by their base control", () => {
  it("admits a callable check with a wrong expectation, and records that only the planner vouches for it", async () => {
    // 9 is right on the base, 10 and 11 wrong: the control holds, and admission cannot see that the
    // task keeps 11 big.
    const declared = plannedContract(
      task,
      {
        requirements: [{ id: "ten", description: "10 is small", quote: "10 is small" }],
        checks: [
          check("boundary", "ten", "change", [
            [9, "small"],
            [10, "small"],
            [11, "small"],
          ]),
        ],
      },
      supplied,
    );
    const admission = await admitPlannedChecks({
      contract: declared,
      base: supplied,
      evidence,
      verifyAtBase: baseRun(),
    });
    expect(admission.decisions).toEqual([
      expect.objectContaining({
        check: "boundary",
        admitted: true,
        basis: "model-asserted",
        claimedChanges: { cases: 2, of: 3 },
      }),
    ]);
    // Admitted as a diagnostic: the requirement is decided by no check.
    expect(admission.contract?.requirements).toEqual([
      supplied.requirements[0],
      {
        id: "ten",
        description: "10 is small",
        checks: [],
        planned: { quote: "10 is small", diagnostics: ["boundary"] },
      },
    ]);
  });

  it("separates a check that cannot load, a preserve check, a quoted requirement left without a check and an invented one", async () => {
    const declared = plannedContract(
      task,
      {
        requirements: [
          { id: "ten", description: "10 is small", quote: "10 is small" },
          { id: "above", description: "above 10 stays big", quote: "Values above 10 remain big" },
          { id: "invented", description: "negative numbers are small" },
        ],
        checks: [
          check("loads-never", "ten", "change", [
            [9, "small"],
            [10, "small"],
          ]),
          check("keeps-big", "above", "preserve", [
            [11, "big"],
            [50, "big"],
          ]),
          // The planner's own idea, contradicted by the base: dropped, and its requirement with it.
          check("negative", "invented", "preserve", [[-1, "tiny"]]),
        ],
      },
      supplied,
    );
    const admission = await admitPlannedChecks({
      contract: declared,
      base: supplied,
      evidence,
      verifyAtBase: baseRun(new Set(["loads-never"])),
    });
    const byCheck = new Map(admission.decisions.map((one) => [one.check, one]));
    expect(byCheck.get("loads-never")).toMatchObject({ admitted: false, broken: true });
    expect(byCheck.get("loads-never")?.claimedChanges).toBeNull();
    expect(byCheck.get("keeps-big")).toMatchObject({
      admitted: true,
      basis: "base-observed",
      claimedChanges: { cases: 0, of: 2 },
    });
    expect(byCheck.get("negative")).toMatchObject({ admitted: false, broken: false });
    // "ten" is the user's words, so it stays sealed with no check; "invented" goes.
    expect(admission.unverifiedRequirements).toEqual(["ten"]);
    expect(admission.droppedRequirements).toEqual(["invented"]);
    expect(
      admission.contract?.requirements.map((one) => [one.id, one.planned?.diagnostics ?? null]),
    ).toEqual([
      ["suite", null],
      ["ten", []],
      ["above", ["keeps-big"]],
    ]);
  });

  const admit = async (
    checks: ReturnType<typeof check>[],
    runs: Readonly<Record<string, SimulatedRun>> = {},
  ) => {
    const declared = plannedContract(
      task,
      {
        requirements: [
          { id: "ten", description: "10 is small", quote: "10 is small" },
          { id: "above", description: "above 10 stays big", quote: "Values above 10 remain big" },
        ].filter((one) => checks.some((named) => named.requirement === one.id)),
        checks,
      },
      supplied,
    );
    const admission = await admitPlannedChecks({
      contract: declared,
      base: supplied,
      evidence,
      verifyAtBase: simulate(runs),
    });
    return new Map(admission.decisions.map((one) => [one.check, one]));
  };

  it("refuses a program the probe saw misread its input while every answer was one value", async () => {
    // Launch 5's shape: the program read input.input off a number, so the project got undefined
    // for every case and answered "big" each time; the probe, in a run of its own, saw the read.
    const decisions = await admit(
      [
        check("misread", "ten", "change", [
          [9, "small"],
          [10, "small"],
        ]),
      ],
      { misread: { answer: () => "big", misreads: true } },
    );
    expect(decisions.get("misread")).toMatchObject({
      admitted: false,
      broken: true,
      finding: "argument-shape",
      control: null,
      reason: expect.stringContaining("called with each case's input itself"),
      excerpt: expect.stringContaining(
        "the program read .input of the value it was called with in case 1",
      ),
      probeRecord: expect.stringMatching(/^sha256:/),
    });
  });

  it("reports a probe's read beside a check whose answers vary, and lets it decide nothing", async () => {
    // A program that copes with both shapes (input.input ?? input) reads the field and is right.
    const decisions = await admit(
      [
        check("boundary", "ten", "change", [
          [9, "small"],
          [10, "small"],
          [12, "big"],
        ]),
      ],
      { boundary: { answer: (n) => atBase(n as number), misreads: true } },
    );
    expect(decisions.get("boundary")).toMatchObject({
      admitted: true,
      finding: "admitted",
      control: { source: "base-agreement", cases: [1, 3] },
      notes: [expect.stringContaining("the read is reported and decides nothing")],
    });
  });

  it("keeps a check whose defect is one answer for every input, its control unestablished", async () => {
    // isPositive returns false for everything; the task wants true for positive numbers. The
    // base's one answer is the defect, and the kept cases (-1, 0) agree with it.
    const positive = (cases: [number, boolean][]) => ({
      id: "positive",
      requirement: "ten",
      purpose: "change" as const,
      program,
      cases: cases.map(([input, expected]) => ({ input, expected, changed: expected })),
      why: "true for positive numbers, false otherwise",
    });
    const decisions = await admit(
      [
        positive([
          [-1, false],
          [0, false],
          [1, true],
        ]),
      ],
      { positive: { answer: () => false } },
    );
    expect(decisions.get("positive")).toMatchObject({
      admitted: true,
      broken: false,
      finding: "unestablished-control",
      control: null,
      establishes: "the program loads and completes on the base",
      unknown: expect.stringContaining(
        "a defect that answers one value gives, and also what an ignored input",
      ),
    });
  });

  it("keeps a passing preserve check of one answer, its control unestablished, and lends it an identical program's control", async () => {
    // Unknown values all answer "big" on the base: a valid preservation whose answers are one value.
    const alone = await admit([
      check("kept-big", "above", "preserve", [
        [11, "big"],
        [50, "big"],
      ]),
    ]);
    expect(alone.get("kept-big")).toMatchObject({
      admitted: true,
      finding: "unestablished-control",
      control: null,
    });
    // Beside a change check running the exact same program, whose answers vary and agree.
    const together = await admit([
      check("kept-big", "above", "preserve", [
        [11, "big"],
        [50, "big"],
      ]),
      check("boundary", "ten", "change", [
        [9, "small"],
        [10, "small"],
        [12, "big"],
      ]),
    ]);
    expect(together.get("kept-big")).toMatchObject({
      admitted: true,
      finding: "admitted",
      control: { source: "shared-program", cases: [], check: "boundary" },
      establishes: expect.stringContaining("planned check boundary runs this exact program"),
    });
    // A different program, however alike, lends nothing.
    const apart = await admit([
      check(
        "kept-big",
        "above",
        "preserve",
        [
          [11, "big"],
          [50, "big"],
        ],
        "w",
        `${program}// apart\n`,
      ),
      check("boundary", "ten", "change", [
        [9, "small"],
        [10, "small"],
        [12, "big"],
      ]),
    ]);
    expect(apart.get("kept-big")?.finding).toBe("unestablished-control");
  });

  it("drops a change check whose kept case the base contradicts, naming the case and what the base gave", async () => {
    // Launch 4's shape: a kept case expecting what the base does not give (foo.txt as text/html).
    const decisions = await admit([
      {
        ...check("boundary", "ten", "change", [
          [9, "small"],
          [10, "small"],
        ]),
        cases: [
          { input: 9, expected: "small", changed: false },
          { input: 10, expected: "small", changed: true },
          { input: 30, expected: "small", changed: false },
        ],
      },
    ]);
    expect(decisions.get("boundary")).toMatchObject({
      admitted: false,
      broken: false,
      finding: "expectation-contradicted",
      reason: expect.stringContaining("case(s) 3 are declared kept (changed: false)"),
      excerpt: expect.stringContaining("line 3 should be"),
    });
    expect(decisions.get("boundary")?.excerpt).not.toContain("line 2");
  });

  it("drops a preserve check the base fails, and says when its answers were one value", async () => {
    const decisions = await admit(
      [
        check("constant", "above", "preserve", [
          [11, "big"],
          [50, "big"],
        ]),
      ],
      { constant: { answer: () => "small" } },
    );
    expect(decisions.get("constant")).toMatchObject({
      admitted: false,
      finding: "disagrees-with-base",
      reason: expect.stringContaining("Every case gave one and the same answer there"),
    });
  });

  it("establishes no control from kept cases of another kind of input than the changed ones", async () => {
    // The kept case is a string, the changed ones numbers: agreement there says nothing about how
    // the program handles the numbers, though the answers differ.
    const decisions = await admit(
      [
        {
          ...check("boundary", "ten", "change", []),
          cases: [
            { input: "nine", expected: "small", changed: false },
            { input: 10, expected: "small", changed: true },
          ],
        },
      ],
      { boundary: { answer: (n) => (typeof n === "string" ? "small" : "big") } },
    );
    expect(decisions.get("boundary")).toMatchObject({
      admitted: true,
      finding: "unestablished-control",
      control: null,
    });
  });

  it("seals nothing when no contract was supplied and no check held its control", async () => {
    const declared = plannedContract(
      task,
      {
        requirements: [{ id: "ten", description: "10 is small", quote: "10 is small" }],
        checks: [
          check("loads-never", "ten", "change", [
            [9, "small"],
            [10, "small"],
          ]),
        ],
      },
      undefined,
    );
    const admission = await admitPlannedChecks({
      contract: declared,
      base: undefined,
      evidence,
      verifyAtBase: baseRun(new Set(["loads-never"])),
    });
    expect(admission.contract).toBeNull();
    expect(admission.unverifiedRequirements).toEqual(["ten"]);
  });
});

/**
 * A preserve check the base fails disagrees with the base. That shows the base and the expectation
 * differ, not which one the task backs: the task can describe an outcome as one that must "still"
 * hold when the base does not give it yet. Here the task names the string "010" and says it must
 * still read as small; the base reads it as 10 and calls it big.
 */
describe("a preserve check the base fails", () => {
  const stillTask =
    'Change classify so 10 is small. A numeric string must still read as its number, so classify("010") must still give "small". Values above 10 remain big.';
  const admitUnder = async (
    checks: ReturnType<typeof check>[],
    reclassified: ReadonlySet<string> = new Set(),
  ) => {
    const declared = plannedContract(
      stillTask,
      {
        requirements: [
          {
            id: "numeric-strings",
            description: "a numeric string reads as its number",
            quote: 'so classify("010") must still give "small"',
          },
          { id: "above", description: "above 10 stays big", quote: "Values above 10 remain big" },
        ].filter((one) => checks.some((named) => named.requirement === one.id)),
        checks,
      },
      supplied,
    );
    return admitPlannedChecks({
      task: stillTask,
      contract: declared,
      base: supplied,
      evidence,
      verifyAtBase: simulate(),
      reclassified,
    });
  };

  it("records a disagreement on an input the task names, not a finding that the requested behaviour is wrong", async () => {
    const admission = await admitUnder([
      check("numeric-strings-kept", "numeric-strings", "preserve", [
        ["010", "small"],
        ["3", "small"],
      ]),
    ]);
    const [decision] = admission.decisions;
    expect(decision).toMatchObject({
      check: "numeric-strings-kept",
      admitted: false,
      finding: "disagrees-with-base",
      disagreements: [
        { case: 1, input: "010", expected: '"small"', base: '"big"', namedByTask: true },
      ],
    });
    // The reason names both readings and does not call the task's words wrong.
    expect(decision?.reason).toContain("disagreement with the base");
    expect(decision?.reason).toContain("task names the input of case 1");
    expect(decision?.reason).not.toContain("contradicts behaviour the task keeps");
    // The requirement is the task's own words: it stays sealed, with no check.
    expect(admission.unverifiedRequirements).toEqual(["numeric-strings"]);
  });

  it("records a genuinely wrong expectation on an input the task does not name as unnamed", async () => {
    const admission = await admitUnder([
      check("above-kept", "above", "preserve", [
        [11, "big"],
        [50, "large"],
      ]),
    ]);
    expect(admission.decisions[0]).toMatchObject({
      admitted: false,
      finding: "disagrees-with-base",
      disagreements: [
        { case: 2, input: 50, expected: '"large"', base: '"big"', namedByTask: false },
      ],
    });
    expect(admission.decisions[0]?.reason).toContain("task names none of these inputs");
  });

  it("admits a check reclassified to change only by the change control, for a case the task names", async () => {
    const admission = await admitUnder(
      [
        {
          ...check("numeric-strings-kept", "numeric-strings", "change", []),
          cases: [
            { input: "010", expected: "small", changed: true },
            { input: "3", expected: "small", changed: false },
            { input: "12", expected: "big", changed: false },
          ],
          why: 'the task asks for it: classify("010") must still give "small", and the base gives big',
        },
      ],
      new Set(["numeric-strings-kept"]),
    );
    expect(admission.decisions[0]).toMatchObject({
      admitted: true,
      finding: "admitted",
      reclassified: true,
    });
    expect(admission.unverifiedRequirements).toEqual([]);
  });

  it("refuses a reclassification whose changed case the task does not name, however it quotes the task", async () => {
    const admission = await admitUnder(
      [
        {
          ...check("above-kept", "above", "change", []),
          cases: [
            { input: 11, expected: "big", changed: false },
            { input: 50, expected: "large", changed: true },
          ],
          why: "Values above 10 remain big",
        },
      ],
      new Set(["above-kept"]),
    );
    expect(admission.decisions[0]).toMatchObject({
      admitted: false,
      finding: "reclassification-unsupported",
      reclassified: true,
    });
    expect(admission.decisions[0]?.reason).toContain("case 2");
    expect(admission.unverifiedRequirements).toEqual(["above"]);
  });

  it("still refuses a reclassified check whose kept case the base contradicts", async () => {
    const admission = await admitUnder(
      [
        {
          ...check("numeric-strings-kept", "numeric-strings", "change", []),
          cases: [
            { input: "010", expected: "small", changed: true },
            { input: "3", expected: "medium", changed: false },
          ],
          why: 'the task says classify("010") must still give "small"',
        },
      ],
      new Set(["numeric-strings-kept"]),
    );
    expect(admission.decisions[0]).toMatchObject({
      admitted: false,
      finding: "expectation-contradicted",
    });
  });
});
