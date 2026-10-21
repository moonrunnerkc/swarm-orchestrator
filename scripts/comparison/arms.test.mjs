import { describe, expect, it } from "vitest";
import {
  claimedSuccess,
  correctionPrompt,
  defaultPins,
  opencodeArgv,
  opencodeTokens,
  opencodeUsage,
  swarmArgv,
  swarmContract,
  swarmTokenCap,
  swarmTokens,
  swarmUsage,
  swarmWorkflowFlags,
  taskPrompt,
} from "./arms.mjs";
import { protectedPaths, runnerConfigurationPaths } from "./change-policy.mjs";
import { taskSchema } from "./schema.mjs";
import { tasks } from "./tasks.mjs";

const upgrade = tasks.find((task) => task.id === "fxp-upgrade-strnum");
const bugfix = tasks.find((task) => task.id === "marked-bugfix-www-case");

describe("the task set", () => {
  it("validates every task and keeps ids unique", () => {
    for (const task of tasks) expect(() => taskSchema.parse(task)).not.toThrow();
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
  });
  it("names the sealed upstream commit nowhere in what an arm receives", () => {
    for (const task of tasks) {
      const shown = `${taskPrompt(task)}\n${JSON.stringify(swarmContract(task))}\n${task.visible.source}`;
      expect(shown).not.toContain(task.upstreamCommit);
    }
  });
});

describe("what both arms are given", () => {
  it("is the same task text, visible check, test command and allowed-change policy", () => {
    const prompt = taskPrompt(bugfix);
    expect(prompt).toContain(bugfix.taskText.trim());
    expect(prompt).toContain(bugfix.visible.command);
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("Do not modify anything under acceptance/visible/.");
    expect(prompt).toContain("regression tests for the change");
    expect(prompt).toContain("Do not delete or weaken existing tests");
    expect(correctionPrompt(bugfix, "visible check exited 1")).toContain("visible check exited 1");
  });

  it("protects the same paths for both arms: Swarm's immutable paths are the policy's, and the prompt names each", () => {
    const contract = swarmContract(bugfix);
    const prompt = taskPrompt(bugfix);
    expect(contract.immutablePaths).toEqual(protectedPaths(bugfix));
    // No test directory is frozen for either arm: a regression test is an allowed change.
    expect(contract.immutablePaths.some((path) => /^(test|tests|spec)(\/|$)/.test(path))).toBe(
      false,
    );
    for (const path of contract.immutablePaths) {
      const named =
        prompt.includes(`${path}/`) ||
        runnerConfigurationPaths.includes(path) ||
        bugfix.immutable.includes(path);
      expect(named, path).toBe(true);
    }
    // The runner configuration files are named to both arms by family.
    for (const family of [
      ".taprc*",
      ".nycrc*",
      ".c8rc*",
      ".mocharc*",
      "jest.config.*",
      "vitest.config.*",
    ])
      expect(prompt).toContain(family);
  });

  it("gives swarm the visible check as a sealed shared command check, and the upgrade preset only for an upgrade", () => {
    expect(swarmContract(bugfix)).toMatchObject({
      version: 1,
      requirements: [{ id: "visible-check", checks: ["visible-check"] }],
      checks: [
        {
          id: "visible-check",
          author: "user",
          exposure: "shared",
          command: bugfix.visible.command,
        },
      ],
      immutablePaths: protectedPaths(bugfix),
    });
    expect(swarmContract(bugfix).preset).toBeUndefined();
    expect(swarmContract(upgrade).preset).toEqual({
      kind: "upgrade",
      manager: "npm",
      manifest: "package.json",
      lockfile: "package-lock.json",
      dependencies: [{ name: "strnum", section: "dependencies", version: "2.4.1" }],
      sourcePaths: [],
    });
  });

  it("builds both invocations with the same model and the prompt as one argument", () => {
    const pins = {
      model: "qwen3.8:27b",
      endpoint: "http://127.0.0.1:8000/v1",
      swarmCli: "/tools/cli.js",
    };
    const swarm = swarmArgv(pins, upgrade, "/w", "abc", "PROMPT", "/c.json", 10 * 60_000);
    expect(swarm).toContain("PROMPT");
    expect(swarm).toContain("--preset");
    // The harness installed every workspace from package-lock.json; the arm names the same one.
    expect(swarm.slice(swarm.indexOf("--lockfile"), swarm.indexOf("--lockfile") + 2)).toEqual([
      "--lockfile",
      "package-lock.json",
    ]);
    expect(swarm.slice(swarm.indexOf("--max-wall-minutes") + 1)[0]).toBe("10");
    expect(swarmArgv(pins, bugfix, "/w", "abc", "PROMPT", "/c.json", 10 * 60_000)).not.toContain(
      "--preset",
    );
    expect(opencodeArgv(pins, "PROMPT", "/w")).toEqual([
      "opencode",
      "run",
      "--dir",
      "/w",
      "--pure",
      "--format",
      "json",
      "-m",
      "rapidmlx/qwen3.8:27b",
      "--title",
      "comparison launch",
      "PROMPT",
    ]);
  });
});

describe("reading what the arms reported", () => {
  it("sums swarm's stopped events and opencode's step-finish parts, and reads nothing as null", () => {
    const swarmOut = [
      JSON.stringify({ schema: "swarm.event.v1", event: { type: "stopped", tokensUsed: 100 } }),
      JSON.stringify({ schema: "swarm.event.v1", event: { type: "stopped", tokensUsed: 50 } }),
      JSON.stringify({ schema: "swarm.result.v1", exitCode: 0, verdict: { acceptable: true } }),
    ].join("\n");
    expect(swarmTokens(swarmOut)).toBe(150);
    expect(swarmTokens("nothing")).toBeNull();
    const openOut = [
      JSON.stringify({
        type: "step_finish",
        part: { type: "step-finish", tokens: { input: 20, output: 5, reasoning: 0 } },
      }),
      JSON.stringify({
        type: "step_finish",
        part: { type: "step-finish", tokens: { input: 30, output: 5 } },
      }),
    ].join("\n");
    expect(opencodeTokens(openOut)).toBe(60);
    expect(opencodeTokens("")).toBeNull();
  });

  it("keeps each arm's spend by kind apart, null where a kind was never reported", () => {
    const swarmOut = [
      JSON.stringify({
        schema: "swarm.event.v1",
        event: {
          type: "stopped",
          tokensUsed: 110,
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            reasoningTokens: null,
            cachedInputTokens: null,
          },
        },
      }),
      JSON.stringify({
        schema: "swarm.event.v1",
        event: {
          type: "stopped",
          tokensUsed: 60,
          usage: { inputTokens: 40, outputTokens: 20, reasoningTokens: 15, cachedInputTokens: 30 },
        },
      }),
    ].join("\n");
    expect(swarmUsage(swarmOut)).toEqual({
      input: 140,
      output: 30,
      reasoning: 15,
      cacheRead: 30,
      cacheWrite: null,
      // A stream that does not carry the unknown-usage count cannot say there were none.
      unknownCalls: null,
      breakdown: "subsets",
    });
    // A stream from a build whose stopped events carried only the total reads as no breakdown.
    expect(
      swarmUsage(
        JSON.stringify({ schema: "swarm.event.v1", event: { type: "stopped", tokensUsed: 5 } }),
      ),
    ).toBeNull();
    const openOut = [
      JSON.stringify({
        type: "step_finish",
        part: {
          type: "step-finish",
          tokens: { input: 20, output: 5, reasoning: 2, cache: { read: 7, write: 1 } },
        },
      }),
      JSON.stringify({
        type: "step_finish",
        part: { type: "step-finish", tokens: { input: 30, output: 5 } },
      }),
    ].join("\n");
    expect(opencodeUsage(openOut)).toEqual({
      input: 50,
      output: 10,
      reasoning: 2,
      cacheRead: 7,
      cacheWrite: 1,
      // Neither step carries the SDK's total, which OpenCode leaves out where nothing was reported.
      unknownCalls: 2,
      breakdown: "disjoint",
    });
    expect(opencodeUsage("")).toBeNull();
  });

  it("counts every token once in both arms' comparable totals, and unreported calls apart", () => {
    // Swarm's figures are the SDK's: cached inside input and reasoning inside output.
    const swarmOut = JSON.stringify({
      schema: "swarm.event.v1",
      event: {
        type: "stopped",
        tokensUsed: 110,
        callsWithUnknownUsage: 1,
        usage: { inputTokens: 100, outputTokens: 10, reasoningTokens: 4, cachedInputTokens: 30 },
      },
    });
    expect(swarmTokens(swarmOut)).toBe(110);
    expect(swarmUsage(swarmOut)?.unknownCalls).toBe(1);
    // OpenCode 1.14 splits the same figures apart: input without the cache, output without reasoning.
    const openOut = JSON.stringify({
      type: "step_finish",
      part: {
        type: "step-finish",
        tokens: { total: 110, input: 69, output: 6, reasoning: 4, cache: { read: 30, write: 1 } },
      },
    });
    expect(opencodeTokens(openOut)).toBe(110);
    expect(opencodeUsage(openOut)?.unknownCalls).toBe(0);
  });

  it("launches swarm with what the earlier invocations left of the launch's allowance", () => {
    const pins = { ...defaultPins, swarmCli: "/tool/cli.js" };
    const task = tasks[0];
    const initial = swarmArgv(pins, task, "/w", "abc", "PROMPT", "/c.json", 10 * 60_000);
    expect(initial[initial.indexOf("--max-tokens") + 1]).toBe(String(swarmTokenCap));
    const correction = swarmArgv(
      pins,
      task,
      "/w",
      "abc",
      "PROMPT",
      "/c.json",
      10 * 60_000,
      123_456,
    );
    expect(correction[correction.indexOf("--max-tokens") + 1]).toBe("123456");
  });

  it("reads a claim of success only from an acceptable swarm verdict or an opencode turn that answered", () => {
    const acceptable = JSON.stringify({ schema: "swarm.result.v1", verdict: { acceptable: true } });
    const refused = JSON.stringify({ schema: "swarm.result.v1", verdict: { acceptable: false } });
    expect(claimedSuccess("swarm", 0, acceptable)).toBe(true);
    expect(claimedSuccess("swarm", 1, refused)).toBe(false);
    expect(claimedSuccess("swarm", 0, "")).toBe(false);
    const start = '{"type":"step_start","part":{"type":"step-start"}}';
    const text = '{"type":"text","part":{"type":"text","text":"done"}}';
    const finish = '{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}';
    const answered = [start, text, finish].join("\n");
    expect(claimedSuccess("opencode", 0, answered)).toBe(true);
    expect(claimedSuccess("opencode", 0, `${answered}\n{"type":"error"}`)).toBe(false);
    expect(claimedSuccess("opencode", 1, answered)).toBe(false);
    // A last turn that finished with no message said nothing: the server stopped it.
    expect(claimedSuccess("opencode", 0, [start, text, finish, start, finish].join("\n"))).toBe(
      false,
    );
    expect(claimedSuccess("opencode", 0, [start, finish].join("\n"))).toBe(false);
    expect(claimedSuccess("opencode", 0, text)).toBe(false);
    expect(claimedSuccess("opencode", 0, "")).toBe(false);
  });
});

describe("Swarm's frozen workflow flags", () => {
  it("appends the manifest's workflow flags and refuses anything else", () => {
    const task = { id: "t", workType: "bugfix", visible: { path: "acceptance/visible/check.mjs" } };
    const argv = swarmArgv(
      { ...defaultPins, swarmFlags: ["--prompt-profile", "concise", "--plan-checks"] },
      task,
      "/w",
      "abc",
      "PROMPT",
      "/c.json",
      10 * 60_000,
    );
    expect(argv.slice(-3)).toEqual(["--prompt-profile", "concise", "--plan-checks"]);
    expect(() => swarmWorkflowFlags(["--max-tokens", "1"])).toThrow("not a workflow flag");
    expect(() => swarmWorkflowFlags(["--prompt-profile", "terse"])).toThrow(
      "takes legacy or concise",
    );
  });
});
