import { describe, expect, it } from "vitest";
import {
  completionMarker,
  parseReply,
  readReply,
  stepsLeftNotice,
  systemPrompt,
  timeLeftNotice,
  truncate,
  turnHeader,
} from "./prompt.ts";

describe("reading a reply", () => {
  it("takes the one bash block as the command", () => {
    expect(parseReply("Let me look.\n```bash\nls -la\n```")).toEqual({
      kind: "command",
      command: "ls -la",
    });
  });

  it("takes the marker alone as completion", () => {
    expect(parseReply(`All done.\n${completionMarker}\n`)).toEqual({ kind: "complete" });
  });

  it("refuses two blocks, or neither a block nor the marker", () => {
    expect(parseReply("```bash\nls\n```\n```bash\npwd\n```").kind).toBe("malformed");
    expect(parseReply("```bash\nls\n```\n```requirements\n[]\n```").kind).toBe("malformed");
    expect(parseReply("I think it works.").kind).toBe("malformed");
  });

  it("takes a requirements block, with or without the marker beside it", () => {
    const json = '[{"id": "R1", "text": "t", "kind": "fix"}]';
    expect(parseReply(`\`\`\`requirements\n${json}\n\`\`\``)).toEqual({
      kind: "requirements",
      json,
      complete: false,
    });
    expect(parseReply(`\`\`\`requirements\n${json}\n\`\`\`\n${completionMarker}`)).toMatchObject({
      complete: true,
    });
  });

  it("reads the marker put in a bash block, bare or echoed, as completion, and nothing more", () => {
    for (const body of [
      completionMarker,
      `echo ${completionMarker}`,
      `echo "${completionMarker}"`,
    ]) {
      expect(parseReply(`\`\`\`bash\n${body}\n\`\`\``)).toEqual({ kind: "complete" });
    }
    expect(parseReply(`\`\`\`bash\nnpm test && echo ${completionMarker}\n\`\`\``).kind).toBe(
      "command",
    );
  });
});

describe("reading a reply a server split", () => {
  it("reads the content first, and the reasoning beside it only when the content holds no reply form", () => {
    expect(readReply("```bash\nls\n```", "```bash\npwd\n```")).toEqual({
      text: "```bash\nls\n```",
      parsed: { kind: "command", command: "ls" },
      fromReasoning: false,
    });
    expect(readReply("I'll look.", "```bash\nls\n```")).toEqual({
      text: "```bash\nls\n```\n\nI'll look.",
      parsed: { kind: "command", command: "ls" },
      fromReasoning: true,
    });
  });

  it("leaves a reply with no form in either part, or no reasoning at all, as the content", () => {
    expect(readReply("I'll look.", "Thinking about it.")).toMatchObject({
      text: "I'll look.",
      parsed: { kind: "malformed" },
      fromReasoning: false,
    });
    expect(readReply("I'll look.", undefined)).toMatchObject({
      text: "I'll look.",
      fromReasoning: false,
    });
  });
});

describe("a turn's header", () => {
  it("carries the task, the status and the last failure verbatim", () => {
    const header = turnHeader("Fix clamp.", " M src/clamp.mjs\n", "check test failed");
    expect(header).toContain("Fix clamp.");
    expect(header).toContain(" M src/clamp.mjs");
    expect(header).toContain("check test failed");
  });

  it("says a clean tree is clean", () => {
    expect(turnHeader("t", "", null)).toContain("(clean)");
  });
});

describe("the output cap", () => {
  it("keeps the start and the end of long output and says how much went", () => {
    const text = `${"a".repeat(8000)}${"b".repeat(8000)}`;
    const cut = truncate(text, 1000);
    expect(cut.startsWith("a".repeat(500))).toBe(true);
    expect(cut.endsWith("b".repeat(500))).toBe(true);
    expect(cut).toContain("15000 bytes omitted");
  });
});

describe("the system prompt", () => {
  it("keeps the change to the task's scope, its files and the versions it states", () => {
    expect(systemPrompt).toContain("Change only what the task needs");
    expect(systemPrompt).toContain("keep\nto the versions and limits it states");
    expect(systemPrompt).toContain("a range such as 9.x where the\n   task gives one");
  });
});

// A run spent its last steps checking the base, never verified a finished change, and stashed it.
describe("the notice that the turns are running out", () => {
  it("comes once, a fifth of the way from the end and at most ten turns out, and not on short runs", () => {
    expect(stepsLeftNotice(10, 60)).toContain("10 turns remain of 60");
    expect(stepsLeftNotice(11, 60)).toBeNull();
    expect(stepsLeftNotice(9, 60)).toBeNull();
    expect(stepsLeftNotice(4, 20)).toContain("4 turns remain of 20");
    expect(stepsLeftNotice(0, 3)).toBeNull();
    expect(stepsLeftNotice(10, 60)).toContain("mark the task complete");
  });
});

// On a slow model the hour ends before the steps do: two held-back runs stopped on time with no
// verification asked for.
describe("the notice that the time is running out", () => {
  it("comes when a fifth of the wall budget remains for turns, and never without a budget", () => {
    const minute = 60_000;
    expect(timeLeftNotice(12 * minute, 60 * minute)).toContain("About 12 minutes remain");
    expect(timeLeftNotice(13 * minute, 60 * minute)).toBeNull();
    expect(timeLeftNotice(5 * minute, Number.POSITIVE_INFINITY)).toBeNull();
    expect(timeLeftNotice(12 * minute, 60 * minute)).toContain("mark the task complete");
  });
});
