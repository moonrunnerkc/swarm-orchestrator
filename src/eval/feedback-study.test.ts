import { describe, expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import type { GenerationProbe } from "./endpoint-health.ts";
import {
  type ArmFork,
  armMayStop,
  armOrder,
  armTerminal,
  eligibilityOf,
  feedbackStudyPolicies,
  feedbackStudyPolicyNamed,
  reviewFeedback,
  runArm,
  runPrefix,
  type SignalReading,
  type StudyArm,
  type StudyEffects,
  type StudyInvocation,
  signalsOf,
  treatmentDigest,
} from "./feedback-study.ts";
import { addedLineText, patchFiles, patchMetrics } from "./patch-metrics.ts";
import type { HalfVerdict } from "./pr-task-judge.ts";

const generating: GenerationProbe = { generates: true, failure: null, detail: "" };

// Distinctive strings standing for the held-back half. Nothing a runner under test is handed
// carries them, and every prompt is checked for them.
const heldBackTitles = ["keeps the global on a name collision", "rejects a caller-supplied store"];
const task = { id: "example/lib#7", taskText: "Add an option for a caller-supplied store." };

const patchOf = (lines: readonly string[], path = "lib/store.js") =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");

const accepted: HalfVerdict = {
  regression: "pass",
  task: "accepted",
  oracleReach: "reached",
  oracleBond: "held",
  bondedMutants: [],
  verified: true,
};
const rejected: HalfVerdict = {
  regression: "pass",
  task: "rejected",
  oracleReach: "unmeasured",
  oracleBond: "not-bonded",
};

const witnessedMutant = {
  id: "lib/store.js:2:invert-comparison",
  path: "lib/store.js",
  line: 2,
  operator: "invert-comparison",
  before: "  if (store === undefined) {",
  after: "  if (store !== undefined) {",
  verdict: "vacuous",
  witness: "coverage",
};

const unreachedAt = (lines: readonly number[]): HalfVerdict => ({
  ...accepted,
  oracleReach: "unreached",
  unreachedByOracle: [{ path: "lib/store.js", lines: [...lines] }],
  verified: false,
});

const invocation = (overrides: Partial<StudyInvocation> = {}): StudyInvocation => ({
  exitCode: 0,
  wallMs: 1_000,
  timedOut: false,
  runId: "20260918T000000-abcdef",
  ledgerDigest: digestOfBytes("ledger"),
  ledgerRecords: 12,
  usage: { modelCalls: 3, failedCalls: 0, inputTokens: 900, outputTokens: 120, status: "reported" },
  stopReason: "completed",
  blinding: { checked: true, references: [] },
  ...overrides,
});

/** A scripted world: each invocation leaves the next patch, and each patch has one verdict. */
function scripted(
  script: readonly {
    readonly patch: string;
    readonly verdict?: HalfVerdict;
    readonly invocation?: Partial<StudyInvocation>;
    readonly probe?: GenerationProbe;
  }[],
) {
  const prompts: string[] = [];
  const judged: string[] = [];
  let at = -1;
  const effects: StudyEffects = {
    invokeAgent: async (prompt) => {
      prompts.push(prompt);
      at += 1;
      return invocation(script[at]?.invocation);
    },
    snapshot: async () => {
      const patch = script[at]?.patch ?? "";
      return {
        digest: digestOfBytes(patch),
        metrics: patchMetrics(patch),
        files: patchFiles(patch),
        lineText: (path, line) => addedLineText(patch, path, line),
      };
    },
    judgeVisible: async (patch) => {
      judged.push(patch.digest);
      const verdict = script[at]?.verdict;
      if (verdict === undefined) throw new Error("the script judged a patch it has no verdict for");
      return verdict;
    },
    endpointGenerates: async () => script[at]?.probe ?? generating,
    realAgent: true,
    now: () => 0,
  };
  return { effects, prompts, judged };
}

const noHeldBack = (prompts: readonly string[]) => {
  for (const prompt of prompts) {
    for (const title of heldBackTitles) expect(prompt).not.toContain(title);
  }
};

const byName = (arms: readonly StudyArm[]) => [...arms];

describe("which findings a verdict carries", () => {
  it("reads reach as the verdict states it, named by the text of each line", () => {
    const patch = patchOf(["export function open(store) {", "  if (store === undefined) {"]);
    const reading = signalsOf({ kind: "judged", verdict: unreachedAt([2]) }, (path, line) =>
      addedLineText(patch, path, line),
    );
    expect(reading).toEqual({
      measured: true,
      reach: [{ path: "lib/store.js", line: 2, text: "if (store === undefined) {" }],
      mutation: [],
    });
  });

  it("takes a mutant only where the check ran it, accepted it and a detector witnessed a change", () => {
    const verdict: HalfVerdict = {
      ...accepted,
      oracleBond: "vacuous",
      bondedMutants: [
        witnessedMutant,
        { ...witnessedMutant, id: "b", line: 3, witness: "repository-suite" },
        // Vacuous in production's reading, and no detector showed the mutant changed anything:
        // it may change nothing, and telling an agent otherwise is not feedback.
        { ...witnessedMutant, id: "c", line: 4, witness: "none" },
        { ...witnessedMutant, id: "d", line: 5, witness: "not-adjudicated" },
        // The check refused it, or never ran its line.
        { ...witnessedMutant, id: "e", line: 6, verdict: "held", witness: "not-adjudicated" },
        { ...witnessedMutant, id: "f", line: 7, verdict: "unshown", witness: "not-adjudicated" },
      ],
    };
    const reading = signalsOf({ kind: "judged", verdict });
    expect(reading.mutation.map((one) => [one.line, one.witness])).toEqual([
      [2, "coverage"],
      [3, "repository-suite"],
    ]);
  });

  it("never reads an unmeasured verdict as one with no findings", () => {
    for (const verdict of [
      rejected,
      { ...accepted, oracleReach: "unmeasured" as const },
      { ...accepted, task: "vacuous" as const },
    ]) {
      expect(signalsOf({ kind: "judged", verdict })).toEqual({
        measured: false,
        reach: [],
        mutation: [],
      });
    }
    expect(signalsOf({ kind: "no-change" }).measured).toBe(false);
  });

  it("skips a vacuous mutant recorded without the fields a prompt would need to name it", () => {
    const reading = signalsOf({
      kind: "judged",
      verdict: {
        ...accepted,
        bondedMutants: [{ id: "x", verdict: "vacuous", witness: "coverage" }],
      },
    });
    expect(reading).toEqual({ measured: true, reach: [], mutation: [] });
  });
});

const forkSignals: SignalReading = {
  measured: true,
  reach: [{ path: "lib/store.js", line: 9, text: "return fallback(store);" }],
  mutation: [
    {
      path: "lib/store.js",
      line: 2,
      operator: "invert-comparison",
      before: "  if (store === undefined) {",
      after: "  if (store !== undefined) {",
      witness: "coverage",
    },
  ],
};
const atFork = { kind: "judged" as const, verdict: accepted };

describe("what each arm is told", () => {
  const feedbackFor = (arm: "neutral" | "reach" | "mutation" | "combined") =>
    reviewFeedback({ policy: "feedback-study-v1", arm, observation: atFork, signals: forkSignals });

  it("tells the neutral arm to review and nothing a verifier found", () => {
    const neutral = feedbackFor("neutral");
    expect(neutral).toBe(feedbackStudyPolicies["feedback-study-v1"].review);
    expect(neutral).not.toMatch(/lib\/store\.js|invert-comparison|never executed|acceptance check/);
  });

  it("gives reach its lines and the statement that visible acceptance still holds", () => {
    expect(feedbackFor("reach")).toBe(
      [
        feedbackStudyPolicies["feedback-study-v1"].review,
        "",
        "An independent verifier judged the change. The acceptance check for this task passes and " +
          "the repository's own checks pass. The verifier also reports the following.",
        "",
        "Changed lines the acceptance check did not exercise:",
        "The acceptance check never executed these executable lines that the change adds, so the " +
          "behaviour on them was not exercised:",
        "  lib/store.js: 9",
        "Address the underlying implementation, or, where a reported line is not executable " +
          "behaviour, show why through your code changes. The acceptance check runs tests of its " +
          "own that you cannot see or edit, so tests written in this workspace do not change what " +
          "it executes.",
      ].join("\n"),
    );
  });

  it("gives mutation the exact mutant: path, line, operator and both texts, and no fix", () => {
    const mutation = feedbackFor("mutation");
    expect(mutation).toContain(
      "  lib/store.js line 2 (invert-comparison): `if (store === undefined) {` became `if (store !== undefined) {`",
    );
    expect(mutation).toContain("still passed with the change in place");
    expect(mutation).not.toContain("lib/store.js: 9");
    expect(mutation).not.toMatch(/score|kill|should (write|return|use)/i);
  });

  it("names a deleted statement as deleted, not as a change into nothing", () => {
    const deleted = reviewFeedback({
      policy: "feedback-study-v1",
      arm: "mutation",
      observation: atFork,
      signals: {
        measured: true,
        reach: [],
        mutation: [
          {
            path: "lib/store.js",
            line: 4,
            operator: "delete-statement",
            before: "  cache.clear();",
            after: "",
            witness: "repository-suite",
          },
        ],
      },
    });
    expect(deleted).toContain(
      "  lib/store.js line 4 (delete-statement): `cache.clear();` was deleted",
    );
  });

  it("gives combined both, each under its own heading", () => {
    const combined = feedbackFor("combined");
    const text = feedbackStudyPolicies["feedback-study-v1"];
    expect(combined.indexOf(text.reach.heading)).toBeGreaterThan(0);
    expect(combined.indexOf(text.mutation.heading)).toBeGreaterThan(
      combined.indexOf(text.reach.heading),
    );
    expect(combined).toContain("  lib/store.js: 9");
    expect(combined).toContain("line 2 (invert-comparison)");
  });

  it("tells every arm alike when the last revision lost visible acceptance", () => {
    const lost = { kind: "judged" as const, verdict: { ...rejected, regression: "fail" as const } };
    for (const arm of ["neutral", "reach", "mutation", "combined"] as const) {
      const feedback = reviewFeedback({
        policy: "feedback-study-v1",
        arm,
        observation: lost,
        signals: signalsOf(lost),
      });
      expect(feedback).toBe(
        [
          feedbackStudyPolicies["feedback-study-v1"].review,
          [
            "An independent verifier judged the change after the last revision.",
            "The repository's own checks fail with the change applied and pass without it.",
            "The acceptance check for the task fails with the change applied.",
          ].join("\n"),
        ].join("\n\n"),
      );
    }
  });

  it("names each treatment by its wording and the kinds it is sent", () => {
    const digests = new Set(
      (["neutral", "reach", "mutation", "combined"] as const).map((arm) =>
        treatmentDigest("feedback-study-v1", arm),
      ),
    );
    expect(digests.size).toBe(4);
    expect(() => feedbackStudyPolicyNamed("feedback-study-v0")).toThrow(/no feedback-study policy/);
  });
});

describe("the shared prefix", () => {
  const order = (arms: readonly ("neutral" | "reach" | "mutation" | "combined")[]) =>
    armOrder("local:model", task.id, arms);

  it("stops at visible acceptance, freezes that state and never names a finding before it", async () => {
    const withBoth: HalfVerdict = {
      ...unreachedAt([2]),
      oracleBond: "vacuous",
      bondedMutants: [witnessedMutant],
      // The repository's checks fail, so the prefix goes on; the lines and the mutant are there.
      regression: "fail",
    };
    const world = scripted([
      {
        patch: patchOf(["export function open(store) {", "  if (store === undefined) {"]),
        verdict: withBoth,
      },
      {
        patch: patchOf([
          "export function open(store) {",
          "  if (store === undefined) {",
          "  return 1",
        ]),
        verdict: { ...withBoth, regression: "pass" },
      },
    ]);
    const prefix = await runPrefix({
      task,
      prefixInvocations: 2,
      effects: world.effects,
      heldBackAvailable: true,
      treeDigest: async () => "tree-1",
      order,
    });
    expect(prefix.status).toBe("accepted");
    expect(world.prompts[0]).toBe(task.taskText);
    expect(world.prompts[1]).toContain("repository's own checks fail");
    expect(world.prompts[1]).not.toMatch(/never executed|invert-comparison|store ===/);
    noHeldBack(world.prompts);
    expect(prefix.frozen).toMatchObject({
      step: 1,
      treeDigest: "tree-1",
      runId: "20260918T000000-abcdef",
    });
    expect(prefix.frozen?.patchDigest).toBe(prefix.steps[1]?.patch.digest);
    expect(prefix.eligibility).toMatchObject({ eligible: true, dualTrigger: true });
    expect([...prefix.eligibility.arms].sort()).toEqual([
      "combined",
      "mutation",
      "neutral",
      "reach",
    ]);
    expect(prefix.eligibility.arms).toEqual(order(["neutral", "reach", "mutation", "combined"]));
  });

  it("records the patch and the findings after every invocation", async () => {
    const world = scripted([
      { patch: patchOf(["a();"]), verdict: rejected },
      { patch: patchOf(["a();", "b();"]), verdict: unreachedAt([2]) },
    ]);
    const prefix = await runPrefix({
      task,
      prefixInvocations: 2,
      effects: world.effects,
      heldBackAvailable: true,
      treeDigest: async () => "tree",
      order: byName,
    });
    expect(prefix.steps.map((step) => step.patch.digest)).toEqual([
      digestOfBytes(patchOf(["a();"])),
      digestOfBytes(patchOf(["a();", "b();"])),
    ]);
    expect(prefix.steps.map((step) => step.signals.measured)).toEqual([false, true]);
    expect(prefix.steps[1]?.signals.reach).toEqual([
      { path: "lib/store.js", line: 2, text: "b();" },
    ]);
  });

  it("is not eligible where no finding is present, where the held-back half is missing, or unmeasured", () => {
    expect(
      eligibilityOf({
        observation: atFork,
        signals: { measured: true, reach: [], mutation: [] },
        heldBackAvailable: true,
        order: byName,
      }),
    ).toMatchObject({ eligible: false, reason: "no-eligible-signal: neither finding is present" });
    expect(
      eligibilityOf({
        observation: atFork,
        signals: forkSignals,
        heldBackAvailable: false,
        order: byName,
      }),
    ).toMatchObject({ eligible: false, reason: "the held-back half is not available" });
    expect(
      eligibilityOf({
        observation: atFork,
        signals: { measured: false, reach: [], mutation: [] },
        heldBackAvailable: true,
        order: byName,
      }).eligible,
    ).toBe(false);
    expect(
      eligibilityOf({
        observation: atFork,
        signals: { ...forkSignals, mutation: [] },
        heldBackAvailable: true,
        order: byName,
      }),
    ).toMatchObject({ eligible: true, arms: ["neutral", "reach", "combined"], dualTrigger: false });
  });

  it("ends as prefix-not-accepted where the budget runs out", async () => {
    const world = scripted([
      { patch: patchOf(["a();"]), verdict: rejected },
      { patch: patchOf(["b();"]), verdict: rejected },
    ]);
    const prefix = await runPrefix({
      task,
      prefixInvocations: 2,
      effects: world.effects,
      heldBackAvailable: true,
      treeDigest: async () => "t",
      order: byName,
    });
    expect(prefix.status).toBe("prefix-not-accepted");
    expect(prefix.frozen).toBeNull();
    expect(prefix.finalPatchDigest).toBe(digestOfBytes(patchOf(["b();"])));
  });
});

describe("an infrastructure failure is never a model outcome", () => {
  const cases: [string, Parameters<typeof scripted>[0][number]][] = [
    [
      "a server that stopped generating",
      { patch: "", probe: { generates: false, failure: "timeout", detail: "no completion" } },
    ],
    [
      "a GPU that ran out of memory and took every call with it",
      {
        patch: "",
        invocation: {
          usage: {
            modelCalls: 1,
            failedCalls: 1,
            inputTokens: null,
            outputTokens: null,
            status: "unknown",
          },
        },
      },
    ],
    [
      "an agent killed at the driver's deadline",
      { patch: patchOf(["half();"]), invocation: { timedOut: true } },
    ],
    ["an agent process that left no session", { patch: "", invocation: { runId: null } }],
  ];

  for (const [name, step] of cases) {
    it(`in the prefix: ${name}`, async () => {
      const world = scripted([step]);
      const prefix = await runPrefix({
        task,
        prefixInvocations: 2,
        effects: world.effects,
        heldBackAvailable: true,
        treeDigest: async () => "t",
        order: byName,
      });
      expect(prefix.status).toBe("infrastructure-failure");
      expect(prefix.steps[0]?.attribution.to).toBe("infrastructure");
      expect(world.judged).toEqual([]);
    });

    it(`in an arm: ${name}`, async () => {
      const world = scripted([step]);
      const arm = await runArm({
        task,
        arm: "reach",
        policy: "feedback-study-v1",
        repairInvocations: 2,
        fork: forkOf(),
        effects: world.effects,
      });
      expect(arm.status).toBe("infrastructure-failure");
      expect(arm.final).toBeNull();
      expect(world.judged).toEqual([]);
    });
  }
});

const forkPatch = patchOf([
  "export function open(store) {",
  "  if (store === undefined) {",
  "  return fallback(store);",
]);
function forkOf(signals: SignalReading = forkSignals): ArmFork {
  return {
    patchDigest: digestOfBytes(forkPatch),
    files: patchFiles(forkPatch),
    observation: atFork,
    signals,
  };
}

describe("an arm, from the fork to its terminal status", () => {
  it("sends updated findings on the second turn and stops once the treatment's finding clears", async () => {
    const second = patchOf([
      "export function open(store) {",
      "  if (store === undefined) {",
      "  x();",
      "  return fallback(store);",
    ]);
    const third = patchOf([
      "export function open(store) {",
      "  if (store === undefined) {",
      "  x();",
      "  y();",
    ]);
    const world = scripted([
      { patch: second, verdict: unreachedAt([3]) },
      { patch: third, verdict: accepted },
    ]);
    const arm = await runArm({
      task,
      arm: "reach",
      policy: "feedback-study-v1",
      repairInvocations: 2,
      fork: forkOf(),
      effects: world.effects,
    });
    expect(world.prompts[0]).toContain("  lib/store.js: 9");
    expect(world.prompts[1]).toContain("  lib/store.js: 3");
    expect(world.prompts[1]).not.toContain("  lib/store.js: 9");
    noHeldBack(world.prompts);
    expect(arm.status).toBe("repaired-signal-cleared");
    expect(arm.repairs).toBe(2);
    expect(arm.steps.map((step) => step.patch.digest)).toEqual([
      digestOfBytes(second),
      digestOfBytes(third),
    ]);
    expect(arm.steps[0]?.progress?.comparedWith).toBe("fork");
    expect(arm.steps[1]?.progress?.comparedWith).toBe(0);
  });

  it("stops a treatment arm after one turn where the finding is already gone", async () => {
    const world = scripted([{ patch: patchOf(["fixed();"]), verdict: accepted }]);
    const arm = await runArm({
      task,
      arm: "mutation",
      policy: "feedback-study-v1",
      repairInvocations: 2,
      fork: forkOf(),
      effects: world.effects,
    });
    expect(arm.repairs).toBe(1);
    expect(arm.status).toBe("repaired-signal-cleared");
  });

  it("runs the neutral arm's whole budget whatever the findings do, and never names them", async () => {
    const world = scripted([
      { patch: patchOf(["fixed();"]), verdict: accepted },
      { patch: patchOf(["fixed();"]), verdict: accepted },
    ]);
    const arm = await runArm({
      task,
      arm: "neutral",
      policy: "feedback-study-v1",
      repairInvocations: 2,
      fork: forkOf(),
      effects: world.effects,
    });
    expect(arm.repairs).toBe(2);
    expect(world.prompts).toEqual([
      `${task.taskText}\n\n${feedbackStudyPolicies["feedback-study-v1"].review}`,
      `${task.taskText}\n\n${feedbackStudyPolicies["feedback-study-v1"].review}`,
    ]);
    expect(arm.status).toBe("repaired-signal-cleared");
  });

  it("recomputes only what the arm is sent: reach never hears of a mutant that appears later", async () => {
    const world = scripted([
      {
        patch: patchOf(["a();"]),
        verdict: {
          ...unreachedAt([1]),
          oracleBond: "vacuous",
          bondedMutants: [{ ...witnessedMutant, line: 1, before: "a();", after: "" }],
        },
      },
      { patch: patchOf(["a();", "b();"]), verdict: unreachedAt([1]) },
    ]);
    await runArm({
      task,
      arm: "reach",
      policy: "feedback-study-v1",
      repairInvocations: 2,
      fork: forkOf(),
      effects: world.effects,
    });
    expect(world.prompts[1]).toContain("  lib/store.js: 1");
    expect(world.prompts[1]).not.toMatch(/invert-comparison|did not notice/);
  });

  it("ends unjudgeable where the visible check gives no verdict", async () => {
    const world = scripted([
      {
        patch: patchOf(["a();"]),
        verdict: {
          ...rejected,
          task: "unjudged",
          judgeFailure: "swarm ci exited 1 without a verdict: boom",
        },
      },
    ]);
    const arm = await runArm({
      task,
      arm: "combined",
      policy: "feedback-study-v1",
      repairInvocations: 2,
      fork: forkOf(),
      effects: world.effects,
    });
    expect(arm.status).toBe("unjudgeable");
    expect(arm.detail).toContain("boom");
  });
});

describe("what an arm's final state is, against the fork", () => {
  const judged = (verdict: HalfVerdict) => ({ kind: "judged" as const, verdict });
  const final = (patch: string, verdict: HalfVerdict, signals: SignalReading) => ({
    patchDigest: digestOfBytes(patch),
    observation: judged(verdict),
    signals,
  });
  const reachOnly = (lines: readonly [number, string][]): SignalReading => ({
    measured: true,
    reach: lines.map(([line, text]) => ({ path: "lib/store.js", line, text })),
    mutation: [],
  });
  const fork = forkOf(
    reachOnly([
      [9, "return fallback(store);"],
      [10, "log();"],
    ]),
  );

  it("reads a byte-identical patch as no change, and a finding that vanished from it as the verifier's movement", () => {
    expect(
      armTerminal({
        arm: "reach",
        fork,
        final: final(
          forkPatch,
          unreachedAt([9, 10]),
          reachOnly([
            [9, "return fallback(store);"],
            [10, "log();"],
          ]),
        ),
      }).status,
    ).toBe("repair-exhausted-no-change");
    expect(
      armTerminal({ arm: "reach", fork, final: final(forkPatch, accepted, reachOnly([])) }).status,
    ).toBe("signal-cleared-without-change");
  });

  it("names a repair that lost visible acceptance before reading any finding", () => {
    expect(
      armTerminal({
        arm: "reach",
        fork,
        final: final("other", rejected, signalsOf(judged(rejected))),
      }).status,
    ).toBe("repair-lost-visible-acceptance");
  });

  it("does not call an unmeasured reading cleared", () => {
    const unread = { ...accepted, oracleReach: "unmeasured" as const };
    expect(
      armTerminal({ arm: "reach", fork, final: final("other", unread, signalsOf(judged(unread))) })
        .status,
    ).toBe("signal-unmeasured-after-repair");
  });

  it("separates cleared, same, shrank, expanded and changed, by line text across a renumbering", () => {
    const at = (signals: SignalReading) =>
      armTerminal({ arm: "reach", fork, final: final("other", unreachedAt([1]), signals) }).status;
    expect(at(reachOnly([]))).toBe("repaired-signal-cleared");
    // The same two lines, moved down by an added line: the same findings, not two new ones.
    expect(
      at(
        reachOnly([
          [11, "return fallback(store);"],
          [12, "log();"],
        ]),
      ),
    ).toBe("repair-exhausted-same-findings");
    expect(at(reachOnly([[9, "return fallback(store);"]]))).toBe(
      "repair-exhausted-findings-shrank",
    );
    expect(
      at(
        reachOnly([
          [9, "return fallback(store);"],
          [10, "log();"],
          [11, "extra();"],
        ]),
      ),
    ).toBe("repair-exhausted-findings-expanded");
    expect(
      at(
        reachOnly([
          [9, "return fallback(store);"],
          [11, "extra();"],
        ]),
      ),
    ).toBe("repair-exhausted-findings-changed");
  });

  it("describes the neutral arm by both kinds and a treatment by its own", () => {
    const both = forkOf();
    const mutationGone: SignalReading = { ...forkSignals, mutation: [] };
    expect(
      armTerminal({ arm: "mutation", fork: both, final: final("other", accepted, mutationGone) })
        .status,
    ).toBe("repaired-signal-cleared");
    expect(
      armTerminal({ arm: "neutral", fork: both, final: final("other", accepted, mutationGone) })
        .status,
    ).toBe("repair-exhausted-findings-shrank");
  });

  it("lets only a treatment arm stop early, and only once its own findings are gone", () => {
    const clear: SignalReading = { measured: true, reach: [], mutation: [] };
    expect(armMayStop("neutral", atFork, clear)).toBe(false);
    expect(armMayStop("reach", atFork, clear)).toBe(true);
    expect(armMayStop("reach", atFork, { ...forkSignals, reach: [] })).toBe(true);
    expect(armMayStop("combined", atFork, { ...forkSignals, reach: [] })).toBe(false);
    expect(armMayStop("reach", judged(rejected), clear)).toBe(false);
    expect(armMayStop("reach", atFork, { measured: false, reach: [], mutation: [] })).toBe(false);
  });
});

describe("the order an eligible pair's arms run in", () => {
  it("is a fixed permutation per model and task, reproduced on a resume", () => {
    const arms = ["neutral", "reach", "mutation", "combined"] as const;
    const one = armOrder("local:a", "x/y#1", arms);
    expect(armOrder("local:a", "x/y#1", [...arms].reverse())).toEqual(one);
    expect([...one].sort()).toEqual([...arms].sort());
    const orders = new Set(
      Array.from({ length: 40 }, (_, at) => armOrder("local:a", `x/y#${at}`, arms).join(",")),
    );
    expect(orders.size).toBeGreaterThan(5);
  });
});
