import { describe, expect, it } from "vitest";
import { describePreflight, type PreflightInput } from "./cli-preflight.ts";
import { glyphsFor } from "./tui/glyphs.ts";

const unicode = glyphsFor({ LANG: "en_US.UTF-8", TERM: "xterm" });

const input: PreflightInput = {
  workspace: "/home/someone/projects/testnow",
  home: "/home/someone",
  baseCommit: "aae1321a9f0c4d7e2b6f8a1c3d5e7f9b0a2c4e6d",
  manifests: ["pyproject.toml"],
  model: { spec: "local:gemma4:31b", reason: "the best served model for this hardware" },
  approval: "ask",
  glyphs: unicode,
};

describe("the preflight card", () => {
  it("names the repository, the manifest, the model and the approval mode, one line each", () => {
    expect(describePreflight(input)).toEqual([
      "✓ repository   ~/projects/testnow at aae1321a",
      "✓ manifest     pyproject.toml",
      "✓ model        local:gemma4:31b  (the best served model for this hardware)",
      "✓ approval     ask  (a on a prompt allows that program for this run; --approve auto answers allowlist prompts itself)",
    ]);
  });

  it("says what auto means where that is the mode", () => {
    const lines = describePreflight({ ...input, approval: "auto" });
    expect(lines[3]).toBe(
      "✓ approval     auto  (off-allowlist commands run without asking; a derivation match still asks)",
    );
  });

  it("marks a missing manifest and a model not yet chosen rather than leaving the line out", () => {
    const lines = describePreflight({ ...input, manifests: [], model: null });
    expect(lines[1]).toBe("✗ manifest     none found");
    expect(lines[2]).toBe("○ model        chosen when the first task is typed");
  });

  it("keeps a workspace outside the home directory as it is", () => {
    const lines = describePreflight({ ...input, workspace: "/srv/build/app" });
    expect(lines[0]).toBe("✓ repository   /srv/build/app at aae1321a");
  });

  it("draws the same card in ASCII where the terminal cannot show the marks", () => {
    const lines = describePreflight({ ...input, glyphs: glyphsFor({ LANG: "C", TERM: "xterm" }) });
    expect(lines[0]).toBe("+ repository   ~/projects/testnow at aae1321a");
    expect(lines.join("\n")).not.toMatch(/[✓✗○]/);
  });
});
