import { describe, expect, it } from "vitest";
import { InvalidCommandLineError, parseCommandLine } from "./cli-options.ts";

const context = { env: {}, currentDirectory: "/work/repo" };

describe("parseCommandLine", () => {
  it("takes the task from the positional words", () => {
    const parsed = parseCommandLine(["add a --version flag to this CLI"], context);
    expect(parsed.task).toBe("add a --version flag to this CLI");
  });

  it("joins an unquoted task back together", () => {
    expect(parseCommandLine(["fix", "the", "build"], context).task).toBe("fix the build");
  });

  it("reads flags from anywhere in the line without swallowing the task", () => {
    const parsed = parseCommandLine(
      ["--model", "local:qwen3-coder:30b-a3b", "fix the build", "--max-steps", "12"],
      context,
    );

    expect(parsed).toEqual({
      task: "fix the build",
      modelSpec: "local:qwen3-coder:30b-a3b",
      workspace: "/work/repo",
      maxSteps: 12,
    });
  });

  it("defaults the model, workspace, and step budget", () => {
    expect(parseCommandLine(["do a thing"], context)).toEqual({
      task: "do a thing",
      modelSpec: "anthropic:claude-opus-5",
      workspace: "/work/repo",
      maxSteps: 40,
    });
  });

  it("lets the environment set the model and a flag override it", () => {
    const withEnv = { ...context, env: { SWARM_MODEL: "openai:gpt-5" } };
    expect(parseCommandLine(["t"], withEnv).modelSpec).toBe("openai:gpt-5");
    expect(parseCommandLine(["--model", "google:gemini-3-pro", "t"], withEnv).modelSpec).toBe(
      "google:gemini-3-pro",
    );
  });

  it("resolves a relative workspace against the current directory", () => {
    expect(parseCommandLine(["--workspace", "../other", "t"], context).workspace).toBe(
      "/work/other",
    );
  });

  it("keeps an absolute workspace as given", () => {
    expect(parseCommandLine(["--workspace", "/elsewhere/repo", "t"], context).workspace).toBe(
      "/elsewhere/repo",
    );
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
    expect(parseCommandLine(["--max-steps", "1", "t"], context).maxSteps).toBe(1);
  });
});
