import { describe, expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { bondRefusesCertification, certifies } from "../gates/certification.ts";
import { patchMetrics } from "./patch-metrics.ts";
import type { HalfVerdict } from "./pr-task-judge.ts";
import {
  type AgentInvocation,
  enforcedRefusals,
  mayStop,
  refusalFeedback,
  runTrajectory,
  type TrajectoryEffects,
  usageOfModelCalls,
} from "./reach-pressure.ts";

const heldBackTitles = ["rejects a caller-supplied store", "keeps the global on a name collision"];
const task = { id: "example/lib#7", taskText: "Add an option for a caller-supplied store." };

const accepted: HalfVerdict = {
  regression: "pass",
  task: "accepted",
  oracleReach: "reached",
  oracleBond: "held",
  verified: true,
};
const rejected: HalfVerdict = {
  regression: "pass",
  task: "rejected",
  oracleReach: "unmeasured",
  oracleBond: "not-bonded",
};
const unreached: HalfVerdict = {
  ...accepted,
  oracleReach: "unreached",
  unreachedByOracle: [{ path: "lib/store.js", lines: [270, 271] }],
  verified: false,
};

const invocation: AgentInvocation = {
  exitCode: 0,
  wallMs: 1_000,
  timedOut: false,
  runId: "20260917T000000-abcdef",
  ledgerDigest: digestOfBytes("ledger"),
  ledgerRecords: 12,
  usage: { modelCalls: 3, failedCalls: 0, inputTokens: 900, outputTokens: 120, status: "reported" },
};

/** A scripted world: each agent invocation leaves the next patch, each patch has one verdict. */
function scripted(script: readonly { patch: string; verdict?: HalfVerdict }[], alive = true) {
  const prompts: string[] = [];
  const judged: string[] = [];
  let at = -1;
  const effects: TrajectoryEffects = {
    invokeAgent: async (prompt) => {
      prompts.push(prompt);
      at += 1;
      return invocation;
    },
    snapshot: async () => {
      const patch = script[at]?.patch ?? "";
      return { digest: digestOfBytes(patch), metrics: patchMetrics(patch) };
    },
    judgeVisible: async (patch) => {
      judged.push(patch.digest);
      const verdict = script[at]?.verdict;
      if (verdict === undefined) throw new Error("the script judged a patch it has no verdict for");
      return verdict;
    },
    endpointAnswers: async () => ({ answered: alive, detail: alive ? "" : "connection refused" }),
    now: () => 0,
  };
  return { effects, prompts, judged };
}
const limits = { prefixInvocations: 2, reachRepairInvocations: 2 };

describe("the two conditions are one trajectory until the visible oracle accepts", () => {
  it("records the same prefix and the same control patch whatever reach says afterwards", async () => {
    const prefix = [{ patch: "first", verdict: rejected }];
    const reachHolds = scripted([...prefix, { patch: "second", verdict: accepted }]);
    const reachFails = scripted([
      ...prefix,
      { patch: "second", verdict: unreached },
      { patch: "third", verdict: accepted },
    ]);

    const same = await runTrajectory({ task, limits, effects: reachHolds.effects });
    const forked = await runTrajectory({ task, limits, effects: reachFails.effects });

    expect(same.status).toBe("reach-not-triggered");
    expect(forked.status).toBe("reach-repaired");
    expect(forked.control).toEqual(same.control);
    expect(forked.visibleAcceptedAt).toBe(same.visibleAcceptedAt);
    // Everything up to the fork reads the same, prompts included.
    expect(forked.steps[0]).toEqual(same.steps[0]);
    expect(reachFails.prompts.slice(0, 2)).toEqual(reachHolds.prompts);
    // Where reach holds, the reach outcome is the control patch and not a second generation.
    expect(same.reach?.patchDigest).toBe(same.control?.patchDigest);
    expect(same.reach).toMatchObject({ triggered: false, repairs: 0, satisfied: true });
  });

  it("never names unreached lines before the fork, even where the verdict carries them", async () => {
    // The oracle accepts and leaves lines unreached, and the repository's own checks fail. Reach
    // enforcement would name the lines here; the prefix is the control condition's, so it does not.
    const brokeTheSuite: HalfVerdict = { ...unreached, regression: "fail" };
    const world = scripted([
      { patch: "first", verdict: brokeTheSuite },
      { patch: "second", verdict: rejected },
    ]);

    const ended = await runTrajectory({ task, limits, effects: world.effects });

    expect(ended.status).toBe("never-visible-accepted");
    expect(world.prompts[1]).toContain("repository's own checks fail");
    expect(world.prompts[1]).not.toMatch(/270|never executed/);
    expect(ended.steps[0]?.refusals.reach).toContain("oracle-did-not-reach-the-change");
    // With no fork there is one patch, and it is both outcomes.
    expect(ended.reach?.patchDigest).toBe(ended.control?.patchDigest);
    expect(ended.reach?.triggered).toBe(false);
  });

  it("starts the treatment from the accepted patch and says only what reach refused", async () => {
    const world = scripted([
      { patch: "first", verdict: unreached },
      { patch: "narrower", verdict: accepted },
    ]);

    const ended = await runTrajectory({ task, limits, effects: world.effects });

    expect(ended.status).toBe("reach-repaired");
    expect(ended.control).toEqual({ patchDigest: digestOfBytes("first"), step: 0 });
    expect(ended.reach).toEqual({
      patchDigest: digestOfBytes("narrower"),
      step: 1,
      triggered: true,
      repairs: 1,
      satisfied: true,
    });
    expect(world.prompts[1]).toContain(task.taskText);
    expect(world.prompts[1]).toContain("lib/store.js: 270, 271");
    expect(world.prompts[1]).not.toMatch(/acceptance check for the task fails|bond|mutant/);
    // Both patches are there to be scored independently.
    expect(world.judged).toEqual([digestOfBytes("first"), digestOfBytes("narrower")]);
  });

  it("ends on the last patch where the repairs run out, and says reach was not satisfied", async () => {
    const world = scripted([
      { patch: "first", verdict: unreached },
      { patch: "broke it", verdict: rejected },
      { patch: "still unreached", verdict: unreached },
    ]);

    const ended = await runTrajectory({ task, limits, effects: world.effects });

    expect(ended.status).toBe("reach-repair-exhausted");
    expect(ended.control?.patchDigest).toBe(digestOfBytes("first"));
    expect(ended.reach).toMatchObject({
      patchDigest: digestOfBytes("still unreached"),
      repairs: 2,
      satisfied: false,
    });
    // A repair that broke the visible oracle is told so, under the reach condition's own policy.
    expect(world.prompts[2]).toContain("acceptance check for the task fails");
  });
});

describe("the held-back oracle stays out of everything the agent reads", () => {
  it("builds every prompt from the task text and verdict fields alone", async () => {
    // A verdict carrying held-back titles in every free-text field a runner or verifier could fill.
    const leaky: HalfVerdict = {
      ...unreached,
      refusal: heldBackTitles.join(" "),
      advice: heldBackTitles.join(" "),
    };
    const world = scripted([
      { patch: "first", verdict: { ...rejected, advice: heldBackTitles.join(" ") } },
      { patch: "second", verdict: leaky },
      { patch: "third", verdict: leaky },
      { patch: "fourth", verdict: leaky },
    ]);

    await runTrajectory({ task, limits, effects: world.effects });

    expect(world.prompts).toHaveLength(4);
    for (const prompt of world.prompts) {
      for (const title of heldBackTitles) expect(prompt).not.toContain(title);
    }
  });

  it("takes a task with no held-back field to leak", () => {
    // The agent side's task is two fields, checked here so widening it is a visible decision.
    const visible: Parameters<typeof runTrajectory>[0]["task"] = task;
    expect(Object.keys(visible).sort()).toEqual(["id", "taskText"]);
  });
});

describe("oracle bonding is recorded and enforced by neither condition", () => {
  const bonds = ["held", "vacuous", "unshown", "not-bonded"] as const;

  it("makes the same stop decision whatever the bond says", () => {
    for (const base of [accepted, unreached, rejected]) {
      for (const arm of ["control", "reach"] as const) {
        const decisions = bonds.map((oracleBond) =>
          mayStop(arm, { kind: "judged", verdict: { ...base, oracleBond } }),
        );
        expect(new Set(decisions).size).toBe(1);
      }
    }
  });

  it("stops on a vacuous bond that production certification refuses", async () => {
    const vacuous: HalfVerdict = { ...accepted, oracleBond: "vacuous", verified: false };
    // Production is untouched: the same record does not certify there.
    expect(bondRefusesCertification).toBe(true);
    expect(
      certifies({
        regression: "pass",
        task: "accepted",
        oracleReach: "reached",
        oracleBond: "vacuous",
      }),
    ).toBe(false);

    const world = scripted([{ patch: "first", verdict: vacuous }]);
    const ended = await runTrajectory({ task, limits, effects: world.effects });

    expect(ended.status).toBe("reach-not-triggered");
    expect(world.prompts).toHaveLength(1);
    const step = ended.steps[0];
    expect(step?.observation).toMatchObject({ kind: "judged", verdict: { oracleBond: "vacuous" } });
    expect(step?.refusals).toEqual({ control: [], reach: [] });
  });

  it("never mentions the bond in feedback", () => {
    const told = refusalFeedback("reach", {
      kind: "judged",
      verdict: { ...unreached, oracleBond: "vacuous" },
    });
    expect(told).not.toMatch(/bond|mutant|vacuous/i);
    expect(enforcedRefusals("reach", { ...unreached, oracleBond: "vacuous" })).toEqual([
      "oracle-did-not-reach-the-change",
    ]);
  });
});

describe("what is not a model outcome is not recorded as one", () => {
  it("reads an empty patch from a live endpoint as the model's, and tries again", async () => {
    const world = scripted([{ patch: "" }, { patch: "second", verdict: accepted }]);

    const ended = await runTrajectory({ task, limits, effects: world.effects });

    expect(ended.status).toBe("reach-not-triggered");
    expect(ended.steps[0]?.observation).toEqual({ kind: "no-change" });
    expect(world.prompts[1]).toContain("found no change");
    expect(world.judged).toHaveLength(1);
  });

  it("reads an empty patch from a dead endpoint as infrastructure, with no outcome for either condition", async () => {
    const world = scripted([{ patch: "" }], false);

    const ended = await runTrajectory({ task, limits, effects: world.effects });

    expect(ended.status).toBe("infrastructure-failure");
    expect(ended.detail).toContain("connection refused");
    expect(ended.control).toBeNull();
    expect(ended.reach).toBeNull();
    expect(world.prompts).toHaveLength(1);
  });

  it("reads a dead endpoint as infrastructure even where an earlier patch is still in the workspace", async () => {
    let calls = 0;
    const world = scripted([
      { patch: "first", verdict: unreached },
      { patch: "first", verdict: unreached },
    ]);
    const effects: TrajectoryEffects = {
      ...world.effects,
      // Alive for the first invocation, gone by the end of the repair.
      endpointAnswers: async () => {
        calls += 1;
        return calls === 1
          ? { answered: true, detail: "" }
          : { answered: false, detail: "connection refused" };
      },
    };

    const ended = await runTrajectory({ task, limits, effects });

    expect(ended.status).toBe("infrastructure-failure");
    expect(ended.control).toBeNull();
    // The unchanged patch was never judged as though it were the model's answer.
    expect(world.judged).toHaveLength(1);
  });

  it("reads an invocation whose every model call failed as infrastructure", async () => {
    const world = scripted([{ patch: "first", verdict: unreached }]);
    const effects: TrajectoryEffects = {
      ...world.effects,
      invokeAgent: async () => ({
        ...invocation,
        usage: {
          modelCalls: 1,
          failedCalls: 1,
          inputTokens: null,
          outputTokens: null,
          status: "unknown",
        },
      }),
    };

    const ended = await runTrajectory({ task, limits, effects });

    expect(ended.status).toBe("infrastructure-failure");
    expect(ended.detail).toContain("model call(s) failed");
    expect(world.judged).toHaveLength(0);
  });

  it("ends a task whose visible oracle could not judge, and does not ask the model to repair that", async () => {
    const world = scripted([
      {
        patch: "first",
        verdict: {
          regression: "unmeasured",
          task: "unjudged",
          judgeFailure: "swarm ci was killed",
        },
      },
    ]);

    const ended = await runTrajectory({ task, limits, effects: world.effects });

    expect(ended.status).toBe("unjudgeable");
    expect(ended.detail).toContain("killed");
    expect(world.prompts).toHaveLength(1);
  });
});

describe("usage that was not reported stays unknown", () => {
  it("adds up reported calls", () => {
    expect(
      usageOfModelCalls([
        {
          type: "model-call",
          payload: { usageStatus: "reported", inputTokens: 10, outputTokens: 4 },
        },
        { type: "tool-call", payload: {} },
        {
          type: "model-call",
          payload: { usageStatus: "reported", inputTokens: 20, outputTokens: 6 },
        },
      ]),
    ).toEqual({
      modelCalls: 2,
      failedCalls: 0,
      inputTokens: 30,
      outputTokens: 10,
      status: "reported",
    });
  });

  it("counts the calls that failed before any answer, by the provider layer's own word", () => {
    expect(
      usageOfModelCalls([
        {
          type: "model-call",
          payload: { usageStatus: "unknown", content: { reason: "call-failed" } },
        },
      ]),
    ).toMatchObject({ modelCalls: 1, failedCalls: 1, status: "unknown" });
  });

  it("gives no total where one call did not report", () => {
    expect(
      usageOfModelCalls([
        {
          type: "model-call",
          payload: { usageStatus: "reported", inputTokens: 10, outputTokens: 4 },
        },
        {
          type: "model-call",
          payload: { usageStatus: "unknown", inputTokens: 0, outputTokens: 0 },
        },
      ]),
    ).toEqual({
      modelCalls: 2,
      failedCalls: 0,
      inputTokens: null,
      outputTokens: null,
      status: "unknown",
    });
  });
});
