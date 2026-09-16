import { describe, expect, it } from "vitest";
import { parseApprovalMode, withToolsApproval } from "./approval-mode.ts";

/**
 * Whether a run answers a shell-allowlist prompt itself or asks the person. Two values, read
 * from a flag, the environment or swarm.toml, and written back into swarm.toml once the person
 * has been asked; the derivation heuristic is never covered by it (ADR 0011).
 */
describe("parsing an approval mode", () => {
  it("accepts the two modes", () => {
    expect(parseApprovalMode("ask", "--approve")).toBe("ask");
    expect(parseApprovalMode("auto", "--approve")).toBe("auto");
  });

  it("refuses anything else, naming the source and both accepted values", () => {
    expect(() => parseApprovalMode("yes", "--approve")).toThrow(/--approve.*ask.*auto/);
    expect(() => parseApprovalMode("", "SWARM_APPROVAL")).toThrow(/SWARM_APPROVAL/);
  });
});

describe("writing the mode into swarm.toml", () => {
  it("starts a file that has nothing in it", () => {
    expect(withToolsApproval("", "auto")).toBe('[tools]\napproval = "auto"\n');
  });

  it("appends a tools table after what the file already holds", () => {
    expect(withToolsApproval('[gates]\ntests = "npm test"\n', "ask")).toBe(
      '[gates]\ntests = "npm test"\n\n[tools]\napproval = "ask"\n',
    );
  });

  it("replaces the value where the table already names one, adding no second table", () => {
    const written = withToolsApproval(
      '[tools]\napproval = "auto"\n\n[gates]\ntests = "x"\n',
      "ask",
    );

    expect(written).toBe('[tools]\napproval = "ask"\n\n[gates]\ntests = "x"\n');
    expect(written.match(/\[tools\]/g)).toHaveLength(1);
  });
});
