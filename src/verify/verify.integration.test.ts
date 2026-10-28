import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seal } from "./held-out.ts";
import { verifyChange } from "./verify.ts";

let root = "";
let repo = "";
let home = "";

const run = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

async function put(path: string, text: string) {
  await mkdir(join(repo, path, ".."), { recursive: true });
  await writeFile(join(repo, path), text);
}

const correct =
  "export function clamp(value, low, high) {\n  return Math.min(high, Math.max(low, value));\n}\n";
const visibleTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { clamp } from "../src/clamp.mjs";',
  'test("clamps above", () => assert.equal(clamp(9, 0, 5), 5));',
  "",
].join("\n");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "verify-it-"));
  repo = join(root, "repo");
  home = join(root, "swarm-home");
  await mkdir(repo);
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "t@example.com"]);
  run(["config", "user.name", "t"]);
  await put("swarm.toml", '[checks]\ntest = "node --test"\n');
  await put("src/clamp.mjs", "export function clamp(value, low, high) {\n  return value;\n}\n");
  await put("test/clamp.test.mjs", visibleTest);
  run(["add", "-A"]);
  run(["commit", "-qm", "base"]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const verify = () =>
  verifyChange({
    workspace: repo,
    request: { kind: "working-tree", base: "HEAD" },
    swarmHome: home,
    version: "test",
  });

describe("verifying a change in a clean checkout", () => {
  it("passes a correct change, with changed-line coverage and a killed mutant", async () => {
    await put("src/clamp.mjs", correct);
    const { statement } = await verify();
    const predicate = statement.predicate;
    expect(predicate.verdict).toBe("pass");
    expect(predicate.checks.map((check) => check.result)).toEqual(["pass"]);
    expect(predicate.coverage).toMatchObject({ status: "measured", tool: "v8" });
    expect(predicate.mutation.status).toBe("killed");
    expect(statement.subject.map((subject) => subject.name)).toEqual(["tree", "change.patch"]);
  });

  it("fails a change whose check fails, and hands back what the check printed", async () => {
    await put("src/clamp.mjs", "export function clamp(value) {\n  return value + 1;\n}\n");
    const outcome = await verify();
    expect(outcome.statement.predicate.verdict).toBe("fail");
    expect(outcome.failureText).toContain("node --test");
  });

  it("refuses an edited test shipped with source, as a verdict rather than an error", async () => {
    await put("src/clamp.mjs", "export function clamp() {\n  return 5;\n}\n");
    await put("test/clamp.test.mjs", visibleTest.replace("clamp(9, 0, 5), 5", "5, 5"));
    const predicate = (await verify()).statement.predicate;
    expect(predicate.verdict).toBe("fail");
    expect(predicate.protectedPaths.violations).toEqual([
      { path: "test/clamp.test.mjs", category: "tests" },
    ]);
  });

  it("judges by the base's checks even where the change rewrites swarm.toml", async () => {
    await put("swarm.toml", '[checks]\ntest = "true"\n');
    const predicate = (await verify()).statement.predicate;
    expect(predicate.checks[0]?.command).toBe("node --test");
    expect(predicate.verdict).toBe("fail");
  });

  it("measures the held-out gap for a change that only satisfies the visible test", async () => {
    await put(
      "test/hidden/clamp.test.mjs",
      visibleTest.replace("../src", "../../src").replace("clamp(9, 0, 5), 5", "clamp(-3, 0, 5), 0"),
    );
    await seal(
      repo,
      "test/hidden/**",
      [{ name: "test", command: "node --test", kind: "test" }],
      home,
    );
    await put(
      "src/clamp.mjs",
      "export function clamp(value, low, high) {\n  return Math.min(high, value);\n}\n",
    );
    const predicate = (await verify()).statement.predicate;
    expect(predicate.heldOut).toMatchObject({
      status: "measured",
      visiblePassRate: 1,
      heldOutPassRate: 0,
      gap: 1,
    });
    expect(predicate.verdict).toBe("fail");
  });

  it("reports a change that does not apply as a failed verdict", async () => {
    const patch = join(root, "bad.patch");
    await writeFile(
      patch,
      "diff --git a/missing b/missing\n--- a/missing\n+++ b/missing\n@@ -1 +1 @@\n-a\n+b\n",
    );
    const outcome = await verifyChange({
      workspace: repo,
      request: { kind: "patch", path: patch, base: "HEAD" },
      swarmHome: home,
      version: "test",
    });
    expect(outcome.statement.predicate.verdict).toBe("fail");
    expect(outcome.statement.predicate.change.applied).toBe(false);
  });

  it("is unmeasured where nothing declares a check", async () => {
    await rm(join(repo, "swarm.toml"));
    run(["commit", "-qam", "no checks"]);
    await put("src/clamp.mjs", correct);
    const predicate = (await verify()).statement.predicate;
    expect(predicate.verdict).toBe("unmeasured");
  });
});
