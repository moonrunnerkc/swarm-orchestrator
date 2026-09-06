import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCommandLine, usage } from "./cli-options.ts";

/**
 * A command in the help text that the parser does not have is a command a reader will type and
 * not get. The two lists drift in both directions: a command added without a help line is
 * undiscoverable, and a help line left behind after a rename is a promise the build does not
 * keep.
 */
const documentedCommands = [
  ...new Set(
    usage
      .split("\n")
      .map((line) => /^ {2}swarm ([a-z][a-z-]*)/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  ),
];

const context = { currentDirectory: "/repo", environment: {} };

/** What each documented command needs on the line beside it to parse at all. */
const argumentsFor: Readonly<Record<string, readonly string[]>> = {
  parallel: ["--tasks", "./tasks.txt"],
  ci: ["--patch", "./candidate.diff"],
  inspect: ["some-run-id"],
  resume: ["some-run-id"],
  abort: ["some-run-id"],
  repair: ["some-run-id"],
  "retry-step": ["some-run-id", "some-step-id"],
  replay: ["./bundle"],
  review: ["./bundle"],
  verify: ["./bundle"],
};

describe("the commands the help text promises", () => {
  it("finds some, so a parsing change cannot make this test vacuous", () => {
    expect(documentedCommands.length).toBeGreaterThan(5);
  });

  for (const name of documentedCommands) {
    it(`parses "swarm ${name}" into a command of that name`, () => {
      const parsed = parseCommandLine([name, ...(argumentsFor[name] ?? [])], context);

      // `run` is the fallback for a bare word, so a documented command landing there is a
      // command the build does not have: the reader typed a name and got a task.
      expect({ name, command: parsed.command }).not.toEqual({ name, command: "run" });
    });
  }
});

describe("the commands the README promises", () => {
  /**
   * The help text and the README are two lists of what this build has, and they drift in both
   * directions: a command added without a README line is undiscoverable, and a README line left
   * behind after a rename is a promise the build does not keep. The help text is already held
   * to the parser above; this holds the README to the help text.
   */
  const readmeCommands = [
    ...new Set(
      readFileSync(new URL("../README.md", import.meta.url), "utf8")
        .split("\n")
        .flatMap((line) => [...line.matchAll(/\bswarm ([a-z][a-z-]+)\b/g)])
        .map((match) => match[1])
        .filter((name): name is string => name !== undefined),
    ),
  ];

  const documented = new Set(
    usage
      .split("\n")
      .map((line) => /^ {2}swarm ([a-z][a-z-]*)/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );

  /** Words that follow "swarm" in prose rather than naming a command. */
  const prose = new Set(["command", "with", "run"]);

  it("finds some, so a formatting change cannot make this test vacuous", () => {
    expect(readmeCommands.length).toBeGreaterThan(5);
  });

  it("names no command the build does not have", () => {
    const missing = readmeCommands.filter(
      (name) => !documented.has(name) && !prose.has(name) && !name.startsWith("--"),
    );

    expect(missing).toEqual([]);
  });
});

describe("switches that take no value", () => {
  /**
   * A switch that is not registered as one eats the word after it, so `--json "fix the bug"`
   * consumed the task and reported that --json needed a value.
   */
  for (const flag of ["--json", "--no-tui", "--color", "--open-evidence", "--install"]) {
    it(`does not swallow the task after ${flag}`, () => {
      const parsed = parseCommandLine([flag, "fix the parser"], context);

      expect(parsed).toMatchObject({ command: "run", task: "fix the parser" });
    });
  }
});
