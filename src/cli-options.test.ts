import { describe, expect, it } from "vitest";
import {
  type CommandLine,
  InvalidCommandLineError,
  parseCommandLine,
  type RunCommand,
} from "./cli-options.ts";

const context = { env: {}, currentDirectory: "/work/repo" };

/** Every test below drives the run command; replay has its own block. */
function parseRun(argv: readonly string[], overrides = context): RunCommand {
  const parsed: CommandLine = parseCommandLine(argv, overrides);
  if (parsed.command !== "run") {
    throw new Error(`expected a run command, got ${parsed.command}`);
  }
  return parsed;
}

describe("parseCommandLine", () => {
  it("takes the task from the positional words", () => {
    const parsed = parseRun(["add a --version flag to this CLI"]);
    expect(parsed.task).toBe("add a --version flag to this CLI");
  });

  it("joins an unquoted task back together", () => {
    expect(parseRun(["fix", "the", "build"]).task).toBe("fix the build");
  });

  it("reads flags from anywhere in the line without swallowing the task", () => {
    const parsed = parseRun([
      "--model",
      "local:qwen3-coder:30b-a3b",
      "fix the build",
      "--max-steps",
      "12",
    ]);

    expect(parsed).toEqual({
      command: "run",
      task: "fix the build",
      modelSpec: "local:qwen3-coder:30b-a3b",
      workspace: "/work/repo",
      maxSteps: 12,
      bundleDirectory: null,
    });
  });

  it("defaults the model, workspace, and step budget", () => {
    expect(parseRun(["do a thing"])).toEqual({
      command: "run",
      task: "do a thing",
      modelSpec: "anthropic:claude-opus-5",
      workspace: "/work/repo",
      maxSteps: 40,
      bundleDirectory: null,
    });
  });

  it("lets the environment set the model and a flag override it", () => {
    const withEnv = { ...context, env: { SWARM_MODEL: "openai:gpt-5" } };
    expect(parseRun(["t"], withEnv).modelSpec).toBe("openai:gpt-5");
    expect(parseRun(["--model", "google:gemini-3-pro", "t"], withEnv).modelSpec).toBe(
      "google:gemini-3-pro",
    );
  });

  it("resolves a relative workspace against the current directory", () => {
    expect(parseRun(["--workspace", "../other", "t"]).workspace).toBe("/work/other");
  });

  it("keeps an absolute workspace as given", () => {
    expect(parseRun(["--workspace", "/elsewhere/repo", "t"]).workspace).toBe("/elsewhere/repo");
  });

  it("refuses an empty task", () => {
    expect(() => parseCommandLine([], context)).toThrow(InvalidCommandLineError);
    expect(() => parseCommandLine(["   "], context)).toThrow(/nothing to do/);
  });

  it("refuses a flag with no value instead of eating the next flag", () => {
    expect(() => parseCommandLine(["--model"], context)).toThrow(/--model needs a value/);
    expect(() => parseCommandLine(["--model", "--max-steps", "5", "t"], context)).toThrow(
      /--model needs a value/,
    );
  });

  it("refuses a step budget that is not a positive whole number", () => {
    // A NaN budget would make every `steps >= maxSteps` check false, disabling the limit.
    for (const raw of ["abc", "0", "-3", "2.5", ""]) {
      expect(() => parseCommandLine(["--max-steps", raw, "t"], context)).toThrow(
        InvalidCommandLineError,
      );
    }
    expect(parseRun(["--max-steps", "1", "t"]).maxSteps).toBe(1);
  });

  it("resolves a bundle destination against the current directory", () => {
    expect(parseRun(["--bundle", "out/evidence", "t"]).bundleDirectory).toBe(
      "/work/repo/out/evidence",
    );
  });
});

describe("the replay command", () => {
  it("takes the bundle directory and nothing else", () => {
    expect(parseCommandLine(["replay", "bundles/session-1"], context)).toEqual({
      command: "replay",
      bundleDirectory: "/work/repo/bundles/session-1",
    });
  });

  it("refuses a replay with no bundle to read", () => {
    expect(() => parseCommandLine(["replay"], context)).toThrow(/needs a bundle directory/);
  });

  it("still reads a task that merely mentions replay", () => {
    expect(parseRun(["make the replay command faster"]).command).toBe("run");
  });
});
