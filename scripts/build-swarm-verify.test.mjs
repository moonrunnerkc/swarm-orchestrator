import { describe, expect, it } from "vitest";
import { assetsBeside, crossings } from "./build-swarm-verify.mjs";

describe("what the standalone verifier's build refuses and copies", () => {
  it("refuses an emitted module under providers, workers, tui, or the run assembly", () => {
    expect(
      crossings([
        "cli-verify.js",
        "providers/registry.js",
        "workers/parallel-run.js",
        "tui/screen.js",
        "agent-run.js",
        "evidence/bundle.js",
      ]),
    ).toEqual([
      "providers/registry.js",
      "workers/parallel-run.js",
      "tui/screen.js",
      "agent-run.js",
    ]);
  });

  it("copies the assets under a directory it emitted a module into, subdirectories included", () => {
    expect(
      assetsBeside(
        ["cli-verify.js", "evidence/bundle.js"],
        ["evidence/verifier/verify.mjs", "select/coding-models.v1.json", "evidence/frozen.json"],
      ),
    ).toEqual(["evidence/verifier/verify.mjs", "evidence/frozen.json"]);
  });

  it("leaves an asset under no emitted directory out of the package, root modules or not", () => {
    expect(assetsBeside(["gates/engine.js"], ["select/coding-models.v1.json"])).toEqual([]);
    expect(assetsBeside(["swarm-verify.js"], ["select/coding-models.v1.json"])).toEqual([]);
    expect(assetsBeside(["swarm-verify.js"], ["shortlist.json"])).toEqual(["shortlist.json"]);
  });
});
