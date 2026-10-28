import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectChecks, renderSwarmToml } from "./detect.ts";
import { parseSwarmToml } from "./swarm-toml.ts";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "detect-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("detecting declared checks", () => {
  it("reads package.json scripts through the lockfile's package manager", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", "check-types": "tsc" } }),
    );
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    expect(await detectChecks(dir)).toEqual([
      { name: "test", command: "pnpm run test", kind: "test" },
      { name: "typecheck", command: "pnpm run check-types", kind: "other" },
    ]);
  });

  it("skips npm's placeholder test script", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    expect(await detectChecks(dir)).toEqual([]);
  });

  it("runs pytest through uv where the project is locked with it", async () => {
    await writeFile(join(dir, "pyproject.toml"), "[project]\nname='x'\n");
    await writeFile(join(dir, "uv.lock"), "");
    expect(await detectChecks(dir)).toEqual([
      { name: "test", command: "uv run pytest -q", kind: "test" },
    ]);
  });

  it("writes a file swarm.toml reads back the same way", async () => {
    const checks = [{ name: "unit", command: "node --test", kind: "test" as const }];
    expect(parseSwarmToml(renderSwarmToml(checks), "swarm.toml").checks).toEqual(checks);
  });
});
