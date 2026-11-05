// Held out from the agent: the Stryker version claimcheck overlays into a real repo, by that
// repo's vitest major, written from the task's wording before either agent started.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ cmd: string; args: readonly string[] }> = [];

vi.mock("../util/exec.js", () => ({
  exec: vi.fn(async (cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args: [...args] });
    return { code: 0, stdout: "", stderr: "" };
  }),
}));

const { prepareToolchain } = await import("./worktree-toolchain.js");

let repo: string;

function repoOnVitest(version: string): void {
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "fixture", devDependencies: { vitest: `^${version}` } }),
  );
  writeFileSync(join(repo, "package-lock.json"), "{}\n");
  mkdirSync(join(repo, "node_modules", "vitest"), { recursive: true });
  writeFileSync(
    join(repo, "node_modules", "vitest", "package.json"),
    JSON.stringify({ name: "vitest", version }),
  );
}

function overlaid(name: string): string {
  const specs = calls.flatMap((call) => call.args).filter((arg) => arg.startsWith(`${name}@`));
  expect(specs.length, `${name} is overlaid`).toBeGreaterThan(0);
  return (specs[0] as string).slice(name.length + 1);
}

beforeEach(() => {
  calls.length = 0;
  repo = mkdtempSync(join(tmpdir(), "claimcheck-overlay-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("Stryker overlay version, held out", () => {
  for (const vitest of ["5.1.0", "4.1.8", "2.1.9"]) {
    it(`overlays Stryker 10 onto a repo on vitest ${vitest}`, async () => {
      repoOnVitest(vitest);
      const prep = await prepareToolchain(repo, join(repo, "unused-toolchain"));
      expect(prep.mutationReady).toBe(true);
      const runner = overlaid("@stryker-mutator/vitest-runner");
      expect(runner).toMatch(/^[\^~]?10(\.\d+){0,2}$/);
      expect(overlaid("@stryker-mutator/core")).toBe(runner);
    });
  }

  it("keeps Stryker 8.7.1 for a repo on vitest 1", async () => {
    repoOnVitest("1.6.0");
    await prepareToolchain(repo, join(repo, "unused-toolchain"));
    expect(overlaid("@stryker-mutator/vitest-runner")).toBe("8.7.1");
    expect(overlaid("@stryker-mutator/core")).toBe("8.7.1");
  });
});
