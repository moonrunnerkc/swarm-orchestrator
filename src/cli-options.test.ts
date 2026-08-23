import { describe, expect, it } from "vitest";
import {
  type CommandLine,
  InvalidCommandLineError,
  parseCommandLine,
  type RunCommand,
} from "./cli-options.ts";

const context = { currentDirectory: "/work/repo" };

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
      baseRef: "HEAD",
      attempts: null,
      task: "fix the build",
      modelSpec: "local:qwen3-coder:30b-a3b",
      workspace: "/work/repo",
      maxSteps: 12,
      bundleDirectory: null,
      localEndpoint: null,
      interfaceFlags: { tui: null, color: null, openEvidence: null },
    });
  });

  it("leaves every unset flag null, because resolution against config is not its job", () => {
    // The environment and swarm.toml sit between flags and defaults, and only the
    // composition root sees all three, so an unset flag must stay visibly unset here.
    expect(parseRun(["do a thing"])).toEqual({
      command: "run",
      baseRef: "HEAD",
      attempts: null,
      task: "do a thing",
      modelSpec: null,
      workspace: "/work/repo",
      maxSteps: null,
      bundleDirectory: null,
      localEndpoint: null,
      interfaceFlags: { tui: null, color: null, openEvidence: null },
    });
  });

  it("takes an explicit local endpoint and refuses one that is not an http(s) url", () => {
    expect(parseRun(["--local-endpoint", "http://127.0.0.1:8000/v1", "t"]).localEndpoint).toBe(
      "http://127.0.0.1:8000/v1",
    );
    expect(() => parseCommandLine(["--local-endpoint", "127.0.0.1:8000", "t"], context)).toThrow(
      /--local-endpoint must be an http\(s\) url/,
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

describe("the gates command", () => {
  it("takes a workspace and a base ref, with no task and no model", () => {
    expect(parseCommandLine(["gates", "--workspace", "pkg", "--base", "main"], context)).toEqual({
      command: "gates",
      workspace: "/work/repo/pkg",
      baseRef: "main",
      bundleDirectory: null,
    });
  });

  it("measures against HEAD unless told otherwise", () => {
    expect(parseCommandLine(["gates"], context)).toMatchObject({ baseRef: "HEAD" });
  });

  it("still reads a task that merely mentions gates", () => {
    expect(parseRun(["make the gates faster"]).command).toBe("run");
  });
});

describe("the select command", () => {
  it("takes no task and no model, because it recommends one", () => {
    expect(parseCommandLine(["select"], context)).toEqual({
      command: "select",
      shortlist: null,
    });
  });

  it("resolves a pinned shortlist file against the current directory", () => {
    expect(parseCommandLine(["select", "--shortlist", "lists/models.json"], context)).toEqual({
      command: "select",
      shortlist: "/work/repo/lists/models.json",
    });
  });

  it("leaves a pinned shortlist URL alone", () => {
    expect(
      parseCommandLine(["select", "--shortlist", "https://example.test/s.json"], context),
    ).toMatchObject({ shortlist: "https://example.test/s.json" });
  });

  it("leaves the bundled keyword alone, so it is not read as a path", () => {
    expect(parseCommandLine(["select", "--shortlist", "bundled"], context)).toMatchObject({
      shortlist: "bundled",
    });
  });

  it("still reads a task that merely mentions select", () => {
    expect(parseRun(["make select faster"]).command).toBe("run");
  });
});

describe("the auto-resolve budget", () => {
  it("leaves the attempt cap null and defaults the base to HEAD", () => {
    expect(parseRun(["t"])).toMatchObject({ attempts: null, baseRef: "HEAD" });
  });

  it("takes an attempt cap, and refuses one that is not a positive whole number", () => {
    expect(parseRun(["--attempts", "5", "t"]).attempts).toBe(5);
    for (const raw of ["0", "-1", "two", "1.5"]) {
      expect(() => parseCommandLine(["--attempts", raw, "t"], context)).toThrow(
        InvalidCommandLineError,
      );
    }
  });
});

describe("the calibrate command", () => {
  it("takes the models, the repeats, and where to put the bundle", () => {
    expect(
      parseCommandLine(
        ["calibrate", "--models", "local:a,local:b", "--repeats", "5", "--bundle", "out"],
        context,
      ),
    ).toEqual({
      command: "calibrate",
      models: ["local:a", "local:b"],
      repeats: 5,
      shortlist: null,
      bundleDirectory: "/work/repo/out",
    });
  });

  it("takes its models from the shortlist when none are named", () => {
    expect(parseCommandLine(["calibrate"], context)).toMatchObject({ models: null, repeats: 3 });
  });

  it("refuses fewer than three repeats, because two cannot show a spread", () => {
    expect(() => parseCommandLine(["calibrate", "--repeats", "2"], context)).toThrow(/at least 3/);
  });

  it("still reads a task that merely mentions calibrate", () => {
    expect(parseRun(["make calibrate faster"]).command).toBe("run");
  });
});

describe("capturing a calibration case", () => {
  it("takes the task, the files it starts from, and the command that judges it", () => {
    expect(
      parseCommandLine(
        [
          "calibrate",
          "--add-case",
          "raise the retry limit to five",
          "--seed",
          "config/limits.mjs, limits.test.mjs",
          "--gate",
          "node --test",
          "--workspace",
          "pkg",
        ],
        context,
      ),
    ).toEqual({
      command: "add-case",
      task: "raise the retry limit to five",
      seed: ["config/limits.mjs", "limits.test.mjs"],
      gateCommand: "node --test",
      workspace: "/work/repo/pkg",
    });
  });

  it("refuses a capture with no seed, because the case would start from nothing", () => {
    expect(() =>
      parseCommandLine(["calibrate", "--add-case", "do a thing", "--gate", "npm test"], context),
    ).toThrow(/--seed/);
  });

  it("refuses a capture with no command to judge it by", () => {
    expect(() =>
      parseCommandLine(["calibrate", "--add-case", "do a thing", "--seed", "a.ts"], context),
    ).toThrow(/--gate/);
  });
});

describe("the routing command", () => {
  it("takes nothing at all, because it only reports", () => {
    expect(parseCommandLine(["routing"], context)).toEqual({ command: "routing" });
  });

  it("still reads a task that merely mentions routing", () => {
    expect(parseRun(["improve the routing table"]).command).toBe("run");
  });
});

describe("the parallel command", () => {
  it("takes a file of tasks, one per line, and where to put the bundle", () => {
    expect(
      parseCommandLine(
        ["parallel", "--tasks", "tasks.txt", "--workspace", "pkg", "--bundle", "out"],
        context,
      ),
    ).toEqual({
      command: "parallel",
      tasksFile: "/work/repo/tasks.txt",
      workspace: "/work/repo/pkg",
      baseRef: "HEAD",
      maxSteps: null,
      attempts: null,
      bundleDirectory: "/work/repo/out",
      modelSpec: null,
      localEndpoint: null,
    });
  });

  it("needs a task file, because a worker per line is how the workers are named", () => {
    expect(() => parseCommandLine(["parallel"], context)).toThrow(/--tasks/);
  });

  it("takes the base to branch every worker from", () => {
    expect(
      parseCommandLine(["parallel", "--tasks", "t.txt", "--base", "main"], context),
    ).toMatchObject({ baseRef: "main" });
  });

  it("still reads a task that merely mentions parallel", () => {
    expect(parseRun(["make the parallel run faster"]).command).toBe("run");
  });
});

describe("the flags that decide what the screen does", () => {
  it("leaves all three unset when none is named, so config still gets its turn", () => {
    expect(parseRun(["t"]).interfaceFlags).toEqual({
      tui: null,
      color: null,
      openEvidence: null,
    });
  });

  it("reads a switch without swallowing the task after it", () => {
    // The parser takes the word after a flag as its value, which would have eaten the task.
    expect(parseRun(["--no-tui", "fix the build"])).toMatchObject({
      task: "fix the build",
      interfaceFlags: { tui: false, color: null, openEvidence: null },
    });
  });

  it("reads the colour switches in both directions", () => {
    expect(parseRun(["--color", "t"]).interfaceFlags.color).toBe("always");
    expect(parseRun(["--no-color", "t"]).interfaceFlags.color).toBe("never");
  });

  it("reads the evidence switches in both directions", () => {
    expect(parseRun(["--open-evidence", "t"]).interfaceFlags.openEvidence).toBe("always");
    expect(parseRun(["--no-open-evidence", "t"]).interfaceFlags.openEvidence).toBe("never");
  });

  it("refuses both halves of a pair rather than picking one", () => {
    expect(() => parseCommandLine(["--color", "--no-color", "t"], context)).toThrow(
      /--color and --no-color contradict/,
    );
    expect(() => parseCommandLine(["--open-evidence", "--no-open-evidence", "t"], context)).toThrow(
      /--open-evidence and --no-open-evidence contradict/,
    );
  });

  it("mixes a switch with a flag that does take a value", () => {
    expect(parseRun(["--no-tui", "--model", "local:a", "t"])).toMatchObject({
      modelSpec: "local:a",
      task: "t",
      interfaceFlags: { tui: false },
    });
  });
});

describe("the review command", () => {
  it("takes a bundle directory and resolves it against the current directory", () => {
    expect(parseCommandLine(["review", "../bundles/one"], context)).toEqual({
      command: "review",
      bundleDirectory: "/work/bundles/one",
    });
  });

  it("refuses a review with no bundle to read", () => {
    expect(() => parseCommandLine(["review"], context)).toThrow(/needs a bundle directory/);
  });

  it("still reads a task that merely mentions review", () => {
    expect(parseRun(["speed up the review page"]).command).toBe("run");
  });
});
