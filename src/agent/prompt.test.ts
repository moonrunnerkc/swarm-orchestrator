import { describe, expect, it } from "vitest";
import { completionMarker, parseReply, truncate, turnHeader } from "./prompt.ts";

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

  it("does not read the marker inside a block as completion", () => {
    expect(parseReply(`\`\`\`bash\necho ${completionMarker}\n\`\`\``).kind).toBe("command");
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
