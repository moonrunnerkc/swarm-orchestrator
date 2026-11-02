import { describe, expect, it } from "vitest";
import { commandExchange, evidenceRef, excerptOf } from "./exchange.ts";

describe("an old turn's excerpt", () => {
  it("keeps whole lines from the start and the end and says how many went between", () => {
    const output = Array.from({ length: 100 }, (_, at) => `line ${at}`).join("\n");
    const cut = excerptOf(output, 100);
    expect(cut.startsWith("line 0\nline 1\n")).toBe(true);
    expect(cut.endsWith("line 98\nline 99")).toBe(true);
    expect(cut).toMatch(/\n\[\.\.\. \d+ lines omitted \.\.\.\]\n/);
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(140);
  });

  it("leaves short output whole, and cuts one long line by bytes", () => {
    expect(excerptOf("ok", 100)).toBe("ok");
    expect(excerptOf("x".repeat(1000), 100)).toContain("900 bytes omitted");
  });

  it("names a command's evidence and its whole output, and shortens a long command", () => {
    const command = `cat > src/a.ts <<'EOF'\n${"const a = 1;\n".repeat(80)}EOF`;
    const exchange = commandExchange({
      reply: `\`\`\`bash\n${command}\n\`\`\``,
      result: "exit code: 0\n",
      fact: {
        step: 4,
        command,
        decision: "allowed",
        exitCode: 0,
        evidence: evidenceRef(`sha256:${"ab".repeat(32)}`),
        output: null,
        files: ["src/a.ts"],
        why: null,
      },
      output: "",
    });
    expect(exchange.fact).toBe("`cat > src/a.ts <<'EOF'` exited 0 [evidence abababababababab]");
    expect(exchange.summary).toBe("exit code: 0\n\n[evidence abababababababab]");
    expect(exchange.brief).toContain("# [82 lines; not repeated here]");
    expect(exchange.brief.endsWith("\n```")).toBe(true);
  });
});
