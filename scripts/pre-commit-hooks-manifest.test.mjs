import { describe, expect, it } from "vitest";
import { preCommitHooksManifest } from "./pre-commit-hooks-manifest.mjs";

describe("the pre-commit framework hook", () => {
  /**
   * The defect, found by running the framework against the published v1.1.0 distribution: as a
   * `node` hook with entry `swarm-verify pre-commit`, npm 11 refused the framework's git install
   * and blocked every commit, good or bad, and under npm 10 the install linked no bin, so a stale
   * global `swarm-verify` answered "pre-commit is not a command this binary has".
   */
  it("runs exactly the pinned verifier, without installing the distribution as a package", () => {
    const manifest = preCommitHooksManifest("1.2.3");
    expect(manifest).toContain("  entry: npx --yes swarm-verify@1.2.3 pre-commit\n");
    expect(manifest).toContain("  language: system\n");
    expect(manifest).not.toMatch(/language: node/);
    expect(manifest).toContain("  pass_filenames: false\n");
  });
});
