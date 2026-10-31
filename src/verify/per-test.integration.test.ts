import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyChange } from "./verify.ts";

// A real runner: this repository's own vitest, run in the clean checkout with its JSON reporter.
const vitest = fileURLToPath(new URL("../../node_modules/.bin/vitest", import.meta.url));

let root = "";
let repo = "";

const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

async function put(path: string, text: string) {
  await mkdir(join(repo, path, ".."), { recursive: true });
  await writeFile(join(repo, path), text);
}

const clamp = (body: string) => `export function clamp(value, low, high) {\n  ${body}\n}\n`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "per-test-it-"));
  repo = join(root, "repo");
  await mkdir(repo);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  await put("swarm.toml", `[checks]\ntest = "${vitest} run --globals"\n`);
  await put("src/clamp.mjs", clamp("return value;"));
  await put(
    "test/clamp.test.mjs",
    [
      'import assert from "node:assert/strict";',
      'import { clamp } from "../src/clamp.mjs";',
      'test("inside", () => assert.equal(clamp(3, 0, 5), 3));',
      'test("above", () => assert.equal(clamp(9, 0, 5), 5));',
      'test("red", () => assert.fail("red at base"));',
      "",
    ].join("\n"),
  );
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const verify = async () =>
  (
    await verifyChange({
      workspace: repo,
      request: { kind: "working-tree", base: "HEAD" },
      swarmHome: join(root, "swarm-home"),
      version: "test",
    })
  ).statement.predicate;

describe("judging a suite that fails at the base commit test by test", () => {
  it("passes a fix with the command failing at both commits, and reuses the base report", async () => {
    await put("src/clamp.mjs", clamp("return Math.min(high, Math.max(low, value));"));
    const predicate = await verify();
    expect(predicate.verdict).toBe("pass");
    expect(predicate.checks[0]).toMatchObject({
      result: "pass",
      exitCode: 1,
      tests: {
        runner: "vitest",
        fixed: ["test/clamp.test.mjs::above"],
        preExisting: ["test/clamp.test.mjs::red"],
        regressed: [],
        counts: { passing: 1 },
      },
    });
    expect(predicate.baseline).toMatchObject({ status: "measured", cached: false });
    expect(predicate.mutation.status).toBe("killed");
    const again = await verify();
    expect(again.baseline).toMatchObject({ cached: true });
    expect(again.verdict).toBe("pass");
  });

  it("fails a change that fixes one test and breaks another", async () => {
    await put("src/clamp.mjs", clamp("return high;"));
    const predicate = await verify();
    expect(predicate.verdict).toBe("fail");
    expect(predicate.checks[0]?.tests).toMatchObject({
      fixed: ["test/clamp.test.mjs::above"],
      regressed: ["test/clamp.test.mjs::inside"],
    });
    expect(predicate.reasons).toContain(
      "check test: 1 test(s) pass at the base commit and fail with the change: test/clamp.test.mjs::inside",
    );
  });
});
