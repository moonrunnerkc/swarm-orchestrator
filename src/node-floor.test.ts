import { describe, expect, it } from "vitest";
import {
  experimentalProcessIsolation,
  isolatedCoverageFloor,
  isolatedCoverageShortfall,
  nodeFloorShortfall,
  processIsolationFlag,
  requiredNodeMajor,
  stableProcessIsolation,
} from "./node-floor.ts";

describe("the runtime floor for running the tool at all", () => {
  it("is Node 22, since only the isolated coverage measurement needs anything newer", () => {
    expect(requiredNodeMajor).toBe(22);
    expect(nodeFloorShortfall("v22.0.0")).toBeNull();
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
  it("is Node 22.8, the first release that lets the harness name process isolation", () => {
    expect(isolatedCoverageFloor).toEqual({ major: 22, minor: 8 });
    expect(isolatedCoverageShortfall("v22.8.0")).toBeNull();
    expect(isolatedCoverageShortfall("v22.22.3")).toBeNull();
    expect(isolatedCoverageShortfall("v24.15.0")).toBeNull();
    expect(isolatedCoverageShortfall("v26.2.1")).toBeNull();
  });

  it("spells the flag the way the running Node takes it", () => {
    // Checked against each runtime, see docs/verifier-first/node-22.md: 22.7 takes neither
    // spelling, 22.8 through 23 take the experimental one, 24 takes the stable one.
    expect(processIsolationFlag("v22.7.0")).toBeNull();
    expect(processIsolationFlag("v22.8.0")).toBe(experimentalProcessIsolation);
    expect(processIsolationFlag("v22.22.3")).toBe(experimentalProcessIsolation);
    expect(processIsolationFlag("v23.11.0")).toBe(experimentalProcessIsolation);
    expect(processIsolationFlag("v24.15.0")).toBe(stableProcessIsolation);
    expect(processIsolationFlag("unknown")).toBeNull();
  });

  it("names the floor, the version found and the flag as the reason coverage is unmeasured", () => {
    const reason = isolatedCoverageShortfall("v22.7.0");

    expect(reason).toContain("node version below the floor for isolated coverage");
    expect(reason).toContain("v22.7.0");
    expect(reason).toContain("process isolation named on the command line");
    expect(reason).toContain("Node 22.8 or newer");
  });

  it("treats a version it cannot read as below this floor too", () => {
    expect(isolatedCoverageShortfall("unknown")).not.toBeNull();
  });
});
