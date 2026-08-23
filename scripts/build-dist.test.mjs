import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assetsUnder } from "./build-dist.mjs";

const src = join(import.meta.dirname, "..", "src");

describe("what the dist build has to carry beyond compiled JavaScript", () => {
  /**
   * The defect this covers, found by running the built CLI rather than by reading it: tsc
   * emits no JSON, so a dist/ built by tsc alone throws ENOENT on the first shortlist read.
   * Each of these is loaded at runtime through import.meta.url, which resolves next to the
   * compiled file rather than next to the source.
   */
  it("finds every non-TypeScript file the runtime reads from beside its module", async () => {
    expect(await assetsUnder(src)).toEqual([
      "evidence/verifier/verify.d.mts",
      "evidence/verifier/verify.mjs",
      "select/calibration-cases.v1.json",
      "select/coding-models.v1.json",
      "select/model-pricing.v1.json",
    ]);
  });

  /**
   * The list above is a snapshot and this is what keeps it honest. Discovery is what the
   * build actually uses, so a new JSON file under src/ cannot miss the package; this fails
   * when one appears, so the snapshot gets updated deliberately rather than drifting.
   */
  it("discovers assets rather than trusting the list, so a new one cannot be missed", async () => {
    const discovered = await assetsUnder(src);
    const byWalking = [];
    for (const entry of await readdir(src, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && !entry.name.endsWith(".ts") && !entry.parentPath.includes("fixtures")) {
        byWalking.push(entry.name);
      }
    }

    expect(discovered.length).toBe(byWalking.length);
  });

  /** A test fixture is not a runtime asset, and shipping one would put a test in the package. */
  it("leaves a test fixture out of the package", async () => {
    const discovered = await assetsUnder(src);
    expect(discovered.filter((asset) => asset.includes("fixtures"))).toEqual([]);
  });

  it("emits no TypeScript, since tsc is what turns those into the files beside them", async () => {
    expect((await assetsUnder(src)).filter((asset) => asset.endsWith(".ts"))).toEqual([]);
  });
});
