import { describe, expect, it } from "vitest";
import {
  claimedSuccess,
  correctionPrompt,
  opencodeArgv,
  opencodeTokens,
  swarmArgv,
  swarmContract,
  swarmTokens,
  taskPrompt,
} from "./arms.mjs";
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
  it("is the same task text, visible check and test command", () => {
    const prompt = taskPrompt(bugfix);
    expect(prompt).toContain(bugfix.taskText.trim());
    expect(prompt).toContain(bugfix.visible.command);
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("Do not modify anything under acceptance/visible/");
    expect(correctionPrompt(bugfix, "visible check exited 1")).toContain("visible check exited 1");
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
      immutablePaths: ["acceptance/visible", "test"],
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

  it("reads a claim of success only from an acceptable swarm verdict or a clean opencode exit", () => {
    const acceptable = JSON.stringify({ schema: "swarm.result.v1", verdict: { acceptable: true } });
    const refused = JSON.stringify({ schema: "swarm.result.v1", verdict: { acceptable: false } });
    expect(claimedSuccess("swarm", 0, acceptable)).toBe(true);
    expect(claimedSuccess("swarm", 1, refused)).toBe(false);
    expect(claimedSuccess("swarm", 0, "")).toBe(false);
    expect(claimedSuccess("opencode", 0, '{"type":"text"}')).toBe(true);
    expect(claimedSuccess("opencode", 0, '{"type":"error"}')).toBe(false);
    expect(claimedSuccess("opencode", 1, "")).toBe(false);
  });
});
