import { describe, expect, it } from "vitest";
import { projectInstruction } from "./agent-run.ts";

describe("telling the model what the project is", () => {
  it("names the detected language, which is what stopped the guessing", () => {
    // Three runs running wrote Python, Python and Go into a workspace whose tests run with
    // `node --test`, each spending its whole budget on work nothing could execute.
    const said = projectInstruction(["node"]);

    expect(said).toContain("node project");
    expect(said).toContain("write the change in that language");
  });

  it("names every one where a repository honestly is more than one", () => {
    expect(projectInstruction(["node", "python"])).toContain("node and python project");
  });

  it("says nothing at all when nothing was detected", () => {
    expect(projectInstruction([])).toBe("");
  });

  it("carries no manifest text, only the harness's own names", () => {
    // A command string is workspace content, and content reaching a system prompt has gone
    // round the provenance tagging every other route into the model passes through.
    const said = projectInstruction(["node"]);

    expect(said).not.toContain("npm");
    expect(said).not.toContain("--test");
    expect(said).not.toContain("package.json");
  });
});
