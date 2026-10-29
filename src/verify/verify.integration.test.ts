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

  it("leaves unmeasured a change whose check failed at base too, and hands back its output", async () => {
    await put("src/clamp.mjs", "export function clamp(value) {\n  return value + 1;\n}\n");
    const outcome = await verify();
    const predicate = outcome.statement.predicate;
    expect(predicate.verdict).toBe("unmeasured");
    expect(predicate.checks[0]).toMatchObject({ result: "pre-existing-failure" });
    expect(predicate.checks[0]?.baseOutputSha256).toMatch(/^[0-9a-f]{64}$/);
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
    expect(predicate.verdict).not.toBe("pass");
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

describe("measuring every check at the base commit first", () => {
  beforeEach(async () => {
    await put(
      "swarm.toml",
      '[checks]\ntest = "node --test test/clamp.test.mjs"\nred = "node --test test/red.test.mjs"\nsyntax = "node --check src/clamp.mjs"\n',
    );
    await put(
      "test/red.test.mjs",
      'import { test } from "node:test";\nimport assert from "node:assert";\ntest("red", () => assert.fail("red at base"));\n',
    );
    run(["add", "-A"]);
    run(["commit", "-qm", "one red test at base"]);
  });

  it("separates a check the change fixed, one that was red before it, and the base run", async () => {
    await put("src/clamp.mjs", correct);
    const predicate = (await verify()).statement.predicate;
    expect(predicate.checks.map((check) => [check.name, check.result])).toEqual([
      ["test", "pass"],
      ["red", "pre-existing-failure"],
      ["syntax", "pass"],
    ]);
    expect(predicate.baseline).toMatchObject({ status: "measured", cached: false });
    if (predicate.baseline.status !== "measured") throw new Error("no baseline");
    expect(predicate.baseline.checks.map((check) => check.result)).toEqual([
      "fail",
      "fail",
      "pass",
    ]);
    const red = predicate.baseline.checks[1]?.outputSha256;
    expect(predicate.checks[1]?.baseOutputSha256).toBe(red);
    expect(predicate.unmeasured).toContain(
      `check red: fails at the base commit (output sha256:${red}) and still fails`,
    );
    // Unmeasured is its own result: an inherited failure never lets the verdict pass.
    expect(predicate.verdict).toBe("unmeasured");
  });

  it("fails a check that passes at base and fails with the change, as a regression", async () => {
    await put("src/clamp.mjs", "export function clamp(value, low, high) {\n  return (;\n}\n");
    const predicate = (await verify()).statement.predicate;
    expect(predicate.checks[2]).toMatchObject({ name: "syntax", result: "fail" });
    expect(predicate.reasons).toContain(
      "check syntax regressed: it passes at the base commit and fails with the change",
    );
    expect(predicate.verdict).toBe("fail");
  });

  it("reuses the base run for the same base commit and environment", async () => {
    await put("src/clamp.mjs", correct);
    await verify();
    const again = (await verify()).statement.predicate;
    expect(again.baseline).toMatchObject({ status: "measured", cached: true });
  });
});

describe("judging held-out checks the code under test cannot disable", () => {
  const sealHidden = async (path: string, text: string, command: string) => {
    await put(path, text);
    await seal(repo, path, [{ name: "test", command, kind: "test" }], home);
  };

  it("fails a held-out check whose node:assert the source replaced at import", async () => {
    await sealHidden(
      "test/hidden/clamp.test.mjs",
      visibleTest.replace("../src", "../../src").replace("clamp(9, 0, 5), 5", "clamp(-3, 0, 5), 0"),
      "node --test",
    );
    await put(
      "src/clamp.mjs",
      'import assert from "node:assert/strict";\nassert.equal = () => {};\nexport function clamp(value, low, high) {\n  return Math.min(high, value);\n}\n',
    );
    const predicate = (await verify()).statement.predicate;
    expect(predicate.reasons).toContain(
      "held-out check test: the code under test changed assert.strict.equal",
    );
    expect(predicate.verdict).toBe("fail");
  });

  it("does the same for Python, where the source patches unittest, and passes an honest fix", async () => {
    await put("swarm.toml", '[checks]\ntest = "python3 -m unittest discover -s tests -t ."\n');
    await put("half.py", "def half(n):\n    return n\n");
    await put("tests/__init__.py", "");
    const visible =
      "import unittest\nfrom half import half\n\nclass T(unittest.TestCase):\n    def test_four(self):\n        self.assertEqual(half(4), 2)\n";
    await put("tests/test_half.py", visible);
    run(["add", "-A"]);
    run(["commit", "-qm", "python"]);
    await sealHidden(
      "tests/test_hidden.py",
      visible.replace("half(4), 2", "half(10), 5"),
      "python3 -m unittest discover -s tests -t .",
    );
    await put(
      "half.py",
      "import unittest\nunittest.TestCase.assertEqual = lambda *args, **kwargs: None\n\ndef half(n):\n    return n\n",
    );
    const cheat = (await verify()).statement.predicate;
    expect(cheat.reasons).toContain(
      "held-out check test: the code under test changed unittest.TestCase.assertEqual",
    );
    expect(cheat.verdict).toBe("fail");
    await put("half.py", "def half(n):\n    return n / 2\n");
    const honest = (await verify()).statement.predicate;
    expect(honest.verdict).toBe("pass");
    expect(honest.heldOut).toMatchObject({ status: "measured", heldOutPassRate: 1 });
  });
});
