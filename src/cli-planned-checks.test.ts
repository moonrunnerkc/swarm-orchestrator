import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { admitPlannedChecks } from "./cli-planned-checks.ts";
import { createTestClock } from "./core/test-doubles.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
import { plannedContract } from "./workers/planned-check-program.ts";

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
const check = (
  id: string,
  requirement: string,
  purpose: "change" | "preserve",
  cases: readonly [number, string][],
  why = "from the task",
) => ({
  id,
  requirement,
  purpose,
  program,
  cases: cases.map(([input, expected]) => ({ input, expected })),
  why,
});

/** Records what each planned check prints on the base, as the verifier's base run would. */
function baseRun(broken: ReadonlySet<string> = new Set()) {
  return async (contract: GoalContract) => {
    for (const one of contract.checks) {
      if (one.behavior?.kind !== "cli") continue;
      const { inputs } = JSON.parse(one.behavior.stdin) as { inputs: number[] };
      const loads = !broken.has(one.id);
      const stdout = loads
        ? inputs.map((n) => `${JSON.stringify({ input: n, result: atBase(n) })}\n`).join("")
        : "";
      await evidence.record({
        type: "goal-check",
        actor: "harness",
        provenance: ["tool-output"],
        payload: asJsonValue({
          phase: "completed",
          checkId: one.id,
          status: stdout === one.behavior.stdout[0]?.value ? "accepted" : "rejected",
          behavior: { exitCode: 0 },
          observation: {
            exitCode: loads ? 0 : 3,
            unavailable: null,
            outputTruncated: false,
            stdout,
            stderr: loads ? "" : "the check program did not load",
          },
        }),
      });
    }
  };
}

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
