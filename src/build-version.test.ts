import { describe, expect, it } from "vitest";
import { describeRunningVersion } from "./build-version.ts";

describe("the version a build reports", () => {
  it("is the manifest's version for the release's own commit, or where no commit was recorded", () => {
    expect(describeRunningVersion("14.4.0", "v14.4.0")).toBe("14.4.0");
    expect(describeRunningVersion("14.4.0", null)).toBe("14.4.0");
  });

  it("names a build of source ahead of the release, which carries the same manifest version", () => {
    expect(describeRunningVersion("14.4.0", "v14.4.0-191-g4215b743d")).toBe(
      "14.4.0 (source build v14.4.0-191-g4215b743d, not the 14.4.0 release)",
    );
    expect(describeRunningVersion("14.4.0", "v14.4.0-dirty")).toContain("not the 14.4.0 release");
  });
});
