import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openEvidenceSession } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import recorded from "./fixtures/no-progress-2026-11-02.json" with { type: "json" };
import { type LoopOptions, runLoop } from "./loop.ts";
import { initialRecord } from "./requirement-record.ts";
import { bash, noEdits, scripted } from "./test-doubles.ts";

/**
 * Two cycles from the post-publish dossier runs, replayed from their ledgers: 36 passing runs of
 * one vitest file, each printing its own clock, and 29 copies of one requirements block sent
 * without the completion marker. Each ran to the 60-step budget.
 */
async function replayOptions(
  model: LoopOptions["model"],
  chokepoint: Chokepoint,
  task: string,
): Promise<LoopOptions> {
  const root = await mkdtemp(join(tmpdir(), "no-progress-"));
  return {
    task,
    model,
    chokepoint,
    evidence: await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "s",
      now: Date.now,
    }),
    environment: "",
    instructions: "",
    record: initialRecord(task),
    status: async () => "",
    diff: async () => "",
    verify: async () => {
      throw new Error("the recorded run never marked the task complete");
    },
    maxSteps: 60,
    maxTokens: 100_000_000,
    turnTokens: 1000,
    turnTime: () => ({ leftMs: Number.POSITIVE_INFINITY, wallMs: Number.POSITIVE_INFINITY }),
    contextTokens: 32_768,
    outputs: { directory: join(root, ".swarm", "outputs"), root },
    log: () => {},
  };
}

describe("session 20261102T210229-519ea0: one passing vitest file, run 36 times", () => {
  const { command, runs } = recorded.vitest;

  it("printed 36 different outputs for one unchanged result", () => {
    expect(runs).toHaveLength(36);
    expect(new Set(runs.map((run) => run.output)).size).toBe(36);
  });

  it("stops as no progress at the second result identical to the first", async () => {
    let at = 0;
    const replay: Chokepoint = {
      ...noEdits,
      async run(ran) {
        expect(ran).toBe(command);
        const output = runs[at]?.output ?? "";
        at += 1;
        return { decision: "allowed", output, exitCode: 0, record: `sha256:${at}` };
      },
    };
    const model = scripted([bash(command)], { counts: "unreported" });
    const ran = await runLoop(await replayOptions(model, replay, "Rerun the walker's tests."));
    expect(ran).toMatchObject({
      stop: "no-progress",
      reason: "the same command printed the same result 3 turns running",
      steps: 3,
    });
    expect(model.seen[2]?.at(-1)?.content).toContain("This is the command you ran last turn");
  });
});

describe("session 20261102T211404-06df43: one requirements block, resent without the marker", () => {
  const { task, replies, outputs } = recorded.requirements;
  const replay: Chokepoint = {
    ...noEdits,
    async run(command) {
      const output = outputs[command as keyof typeof outputs];
      if (output === undefined) throw new Error(`not in the recording: ${command}`);
      return { decision: "allowed", ...output, record: "sha256:recorded" };
    },
  };

  it("sent the same block 29 times running after a command between the first two", () => {
    const blocks = replies.map((one) => /```requirements\n([\s\S]*?)\n```/.exec(one.reply)?.[1]);
    expect(blocks[1]).toBeUndefined();
    expect(new Set(blocks.slice(2))).toEqual(new Set([blocks[0]]));
    expect(blocks.slice(2)).toHaveLength(29);
  });

  it("stops as no progress on the second identical block in a row, keeping the record", async () => {
    const model = scripted(
      replies.map((one) => one.reply),
      { counts: "unreported" },
    );
    const ran = await runLoop(await replayOptions(model, replay, task));
    expect(ran).toMatchObject({
      stop: "no-progress",
      reason:
        "the same requirements block arrived twice running without the completion marker, and the record did not change",
      steps: 4,
      verifications: 0,
    });
    expect(ran.record.requirements.map((one) => one.evidence.tests)).toEqual([
      [
        { name: "walkRepo > should skip .venv directory" },
        { name: "walkRepo > should skip node_modules directory" },
      ],
    ]);
  });

  it("goes on when a block in a row changes the record", async () => {
    const first = replies[0]?.reply ?? "";
    const changed = first.replace(
      '"assumptions": []',
      '"assumptions": ["the tests run on vitest"]',
    );
    expect(changed).not.toBe(first);
    const model = scripted([first, changed, bash("your command here")], { counts: "unreported" });
    const ran = await runLoop({
      ...(await replayOptions(model, replay, task)),
      maxSteps: 4,
    });
    expect(ran).toMatchObject({ stop: "step-budget", steps: 4 });
  });
});
