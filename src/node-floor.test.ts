import { describe, expect, it } from "vitest";
import {
  isolatedCoverageNodeMajor,
  isolatedCoverageShortfall,
  nodeFloorShortfall,
  requiredNodeMajor,
} from "./node-floor.ts";

describe("the runtime floor for running the tool at all", () => {
  it("is Node 22, since only the isolated coverage measurement needs anything newer", () => {
    expect(requiredNodeMajor).toBe(22);
    expect(nodeFloorShortfall("v22.22.3")).toBeNull();
    expect(nodeFloorShortfall("v24.0.0")).toBeNull();
  });

  it("names the version found and the version required, in one line", () => {
    const line = nodeFloorShortfall("v20.19.0");

    expect(line).toContain("Node 22 or newer");
    expect(line).toContain("found v20.19.0");
    expect(line?.includes("\n")).toBe(false);
  });

  it("treats a version it cannot read as below the floor rather than above it", () => {
    expect(nodeFloorShortfall("unknown")).not.toBeNull();
  });
});

describe("the floor for the process-isolated coverage measurement", () => {
  it("is Node 24, because of the isolation flag the coverage arm spawns the runner with", () => {
    expect(isolatedCoverageNodeMajor).toBe(24);
    expect(isolatedCoverageShortfall("v24.15.0")).toBeNull();
    expect(isolatedCoverageShortfall("v26.2.1")).toBeNull();
  });

  it("names the floor, the version found and the flag as the reason coverage is unmeasured", () => {
    const reason = isolatedCoverageShortfall("v22.22.3");

    expect(reason).toContain("node version below the floor for isolated coverage");
    expect(reason).toContain("v22.22.3");
    expect(reason).toContain("--test-isolation=process");
    expect(reason).toContain("Node 24 or newer");
  });

  it("treats a version it cannot read as below this floor too", () => {
    expect(isolatedCoverageShortfall("unknown")).not.toBeNull();
  });
});
