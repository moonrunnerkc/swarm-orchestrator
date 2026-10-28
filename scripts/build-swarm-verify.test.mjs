import { describe, expect, it } from "vitest";
import { crossings } from "./build-swarm-verify.mjs";

describe("what the standalone verifier's build refuses", () => {
  it("refuses the agent loop, its chokepoint and model client, and the swarm entry", () => {
    expect(
      crossings([
        "cli-verify.js",
        "verify/verify.js",
        "agent/loop.js",
        "tools/chokepoint.js",
        "core/model-client.js",
        "cli.js",
        "cli-doctor.js",
      ]),
    ).toEqual([
      "agent/loop.js",
      "tools/chokepoint.js",
      "core/model-client.js",
      "cli.js",
      "cli-doctor.js",
    ]);
  });
});
