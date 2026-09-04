import { describe, expect, it } from "vitest";
import { nodeFloorShortfall, requiredNodeMajor } from "./node-floor.ts";

describe("the runtime floor", () => {
  it("is Node 24, because of the isolation flag the coverage cycle needs", () => {
    expect(requiredNodeMajor).toBe(24);
  });

  it("says nothing on a runtime at or above the floor", () => {
    expect(nodeFloorShortfall("v24.0.0")).toBeNull();
    expect(nodeFloorShortfall("v26.2.1")).toBeNull();
  });

  it("names the version found, the version required, and the one feature, in one line", () => {
    const line = nodeFloorShortfall("v22.3.0");

    expect(line).toContain("Node 24 or newer");
    expect(line).toContain("found v22.3.0");
    expect(line).toContain("--test-isolation=process");
    expect(line?.includes("\n")).toBe(false);
  });

  it("treats a version it cannot read as below the floor rather than above it", () => {
    expect(nodeFloorShortfall("unknown")).not.toBeNull();
  });
});
