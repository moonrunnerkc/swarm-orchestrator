import { describe, expect, it } from "vitest";
import { campaignDirectories } from "./campaign-layout.mjs";

describe("where a campaign's files live", () => {
  it("puts the unnamed campaign at results/ and corpus/, as the campaign of 2026-09-02 is", () => {
    const layout = campaignDirectories("/c");

    expect(layout).toEqual({
      name: null,
      root: "/c",
      results: "/c/results",
      corpus: "/c/corpus",
      report: "/c/results/report.md",
      cliRecord: "/c/results/cli.json",
    });
  });

  it("puts a named campaign under campaigns/<name>/, sharing nothing with another campaign's results", () => {
    const layout = campaignDirectories("/c", "fixed-cli");

    expect(layout).toEqual({
      name: "fixed-cli",
      root: "/c/campaigns/fixed-cli",
      results: "/c/campaigns/fixed-cli/results",
      corpus: "/c/campaigns/fixed-cli/corpus",
      report: "/c/campaigns/fixed-cli/results/report.md",
      cliRecord: "/c/campaigns/fixed-cli/results/cli.json",
    });
    expect(layout.results.startsWith(campaignDirectories("/c").results)).toBe(false);
  });

  it("refuses a name that could name a path rather than a campaign", () => {
    for (const name of ["", "../results", "Fixed CLI", "a/b", "-x", "x".repeat(41)]) {
      expect(() => campaignDirectories("/c", name)).toThrow("a campaign name is lower-case letters");
    }
  });
});
