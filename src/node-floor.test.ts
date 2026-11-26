import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeFloor, nodeFloorShortfall } from "./node-floor.ts";

const manifest = (path: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", path), "utf8")) as {
    engines: { node: string };
  };

describe("the runtime floor", () => {
  it("is the floor the manifest declares, and no lower than the verifier's", () => {
    const floor = `>=${nodeFloor.major}.${nodeFloor.minor}.0`;
    expect(manifest("package.json").engines.node).toBe(floor);
    expect(manifest("node_modules/swarm-verify/package.json").engines.node).toBe(floor);
  });

  it("lets the floor and anything newer run", () => {
    expect(nodeFloorShortfall("v22.13.0")).toBeNull();
    expect(nodeFloorShortfall("v22.22.3")).toBeNull();
    expect(nodeFloorShortfall("v24.0.0")).toBeNull();
  });

  it("names the version found and the version required, in one line", () => {
    for (const version of ["v20.19.0", "v22.12.0"]) {
      const line = nodeFloorShortfall(version);
      expect(line).toContain("Node 22.13 or newer");
      expect(line).toContain(`found ${version}`);
      expect(line?.includes("\n")).toBe(false);
    }
  });

  it("treats a version it cannot read as below the floor rather than above it", () => {
    expect(nodeFloorShortfall("unknown")).not.toBeNull();
  });
});
