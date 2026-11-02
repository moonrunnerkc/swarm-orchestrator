import { describe, expect, it } from "vitest";
import { diffSections, digestOf, measuredTokens, movedFiles, unresolvedOf } from "./context.ts";
import { type CommandFact, commandExchange, noteExchange } from "./exchange.ts";
import { initialRecord } from "./requirement-record.ts";

const fact = (step: number, command: string, exitCode: number, why: string | null = null) =>
  ({
    step,
    command,
    decision: "allowed",
    exitCode,
    evidence: `${step}`.padStart(16, "a"),
    output: null,
    files: command.startsWith("cat ") ? [command.slice(4)] : [],
    why,
  }) satisfies CommandFact;

const ran = (one: CommandFact) => commandExchange({ reply: "", result: "", fact: one, output: "" });

const digest = (folded: Parameters<typeof digestOf>[0]["folded"]) =>
  digestOf({
    folded,
    measured: 25_000,
    contextTokens: 32_768,
    unresolved: ["R1 failed: failing: test/half.test.mjs::half"],
    verification: "bbbbbbbbbbbbbbbb",
  });

describe("the compaction digest", () => {
  it("states every folded turn with the evidence behind it", () => {
    const text = digest([
      ran(fact(1, "npm test", 1, "FAIL test/half.test.mjs")),
      ran(fact(2, "cat src/a.ts", 0)),
      noteExchange({ step: 3, reply: "", brief: "", result: "", fact: "a requirements block" }),
    ]);
    expect(text).toContain(
      "Turns 1 to 3 were compacted to fit the context (25000 of 32768 tokens).",
    );
    expect(text).toContain("- step 1: `npm test` exited 1 [evidence aaaaaaaaaaaaaaa1]");
    expect(text).toContain("- step 3: a requirements block");
  });

  it("names the failed approaches and why, the files read and edited, and the open requirements", () => {
    const edited = { ...ran(fact(2, "cat src/a.ts", 0)), edited: ["src/a.ts"] };
    const text = digest([ran(fact(1, "npm test", 1, "FAIL test/half.test.mjs")), edited]);
    expect(text).toContain(
      "Failed approaches, worth not repeating as they were:\n- step 1: `npm test` exited 1: FAIL test/half.test.mjs [evidence aaaaaaaaaaaaaaa1]",
    );
    expect(text).toContain("Files read or named, by step: src/a.ts (2).");
    expect(text).toContain("Files edited, by the step after which they changed: src/a.ts (2).");
    expect(text).toContain(
      "Unresolved requirements at the last verification [evidence bbbbbbbbbbbbbbbb]:\n- R1 failed: failing: test/half.test.mjs::half",
    );
  });

  it("says which reads are being repeated and to read only the lines needed, not whole files again", () => {
    const text = digest([
      ran(fact(1, "cat src/a.ts", 0)),
      ran(fact(2, "cat src/b.ts", 0)),
      ran(fact(3, "cat src/a.ts", 0)),
    ]);
    expect(text).toContain("Ran more than once: `cat src/a.ts` (2 times).");
    expect(text).toContain("Files read or named, by step: src/a.ts (1, 3), src/b.ts (2).");
    expect(text).toContain("Read only the lines you need (grep -n, sed -n 'a,bp')");
    expect(text).not.toContain("read files again");
  });
});

describe("what the context measures", () => {
  it("scales the estimate by the runtime's own count, never below the estimate", () => {
    expect(measuredTokens(1000, 1.5)).toBe(1500);
    // A runtime that reuses a cached prefix may count only what it evaluated.
    expect(measuredTokens(1000, 0.1)).toBe(1000);
  });

  it("leaves every requirement open before a verification, and the unsatisfied ones after", () => {
    expect(unresolvedOf(initialRecord("t"), null)).toEqual(["R1 not verified yet"]);
    const findings = "state: incomplete\nR1 satisfied\nR2 failed: failing: a\nregression: none";
    expect(unresolvedOf(initialRecord("t"), findings)).toEqual(["R2 failed: failing: a"]);
  });

  it("tells which files' changes moved between two diffs", () => {
    const one = "diff --git a/a.ts b/a.ts\n+1\ndiff --git a/b.ts b/b.ts\n+1";
    const two =
      "diff --git a/a.ts b/a.ts\n+2\ndiff --git a/b.ts b/b.ts\n+1\ndiff --git a/c.ts b/c.ts";
    expect([...diffSections(one).keys()]).toEqual(["a.ts", "b.ts"]);
    expect(movedFiles(diffSections(one), diffSections(two))).toEqual(["a.ts", "c.ts"]);
    expect(movedFiles(diffSections(two), diffSections(""))).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});
