import { describe, expect, it } from "vitest";
import { readShellStages } from "./shell-command.ts";
import { classifyShellCommand } from "./shell-observation.ts";

describe("readShellStages", () => {
  it("keeps the operator that joins each command to the one before it", () => {
    expect(
      readShellStages("cd w && npm test 2>&1 | tail -5 || true; echo done")?.map((stage) => [
        stage.executable,
        stage.after,
      ]),
    ).toEqual([
      ["cd", null],
      ["npm", "&&"],
      ["tail", "|"],
      ["true", "||"],
      ["echo", ";"],
    ]);
  });

  it("does not count a redirect target as a command", () => {
    expect(readShellStages("npm test > out.txt && cat out.txt")?.map((s) => s.executable)).toEqual([
      "npm",
      "cat",
    ]);
  });
});

describe("classifyShellCommand", () => {
  it("reads printing commands as inspections, whatever their exit status", () => {
    expect(classifyShellCommand("sed -n '188,190p' src/escape.ts").kind).toBe("inspection");
    expect(classifyShellCommand("ls src | head -3").kind).toBe("inspection");
    expect(classifyShellCommand("grep -rn foo src").kind).toBe("inspection");
    expect(classifyShellCommand("git diff --stat").kind).toBe("inspection");
  });

  it("reads anything else as a check keyed by its subject, without the workspace cd or filters", () => {
    expect(classifyShellCommand("npm run lint 2>&1")).toEqual({
      kind: "check",
      subject: "npm run lint",
      statusIsTheCheck: true,
    });
    expect(classifyShellCommand("cd /work/repo && npm test")).toMatchObject({
      subject: "npm test",
      statusIsTheCheck: true,
    });
    expect(classifyShellCommand("git commit -m x").kind).toBe("check");
  });

  it("says when the shell's status belongs to a filter or a fallback rather than the check", () => {
    expect(classifyShellCommand("npm test 2>&1 | tail -20")).toEqual({
      kind: "check",
      subject: "npm test",
      statusIsTheCheck: false,
    });
    expect(classifyShellCommand("npx biome check --write . 2>&1 || true").statusIsTheCheck).toBe(
      false,
    );
    expect(classifyShellCommand("npm test; echo done").statusIsTheCheck).toBe(false);
    expect(classifyShellCommand("npm run build && npm test && echo ok")).toMatchObject({
      subject: "npm run build && npm test",
      statusIsTheCheck: true,
    });
  });

  it("calls a command it cannot read a check of unknown status, never an inspection", () => {
    expect(classifyShellCommand("cat $(ls)")).toEqual({
      kind: "check",
      subject: "cat $(ls)",
      statusIsTheCheck: false,
    });
  });
});
