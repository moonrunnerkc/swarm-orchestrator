import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "./checks.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("running a check", () => {
  it("runs the source on disk after a same-size rewrite within the same second", async () => {
    // Python trusts a cached .pyc whose source has the same size and whole-second mtime, which is
    // what a mutant restored inside one second looks like.
    const source = join(dir, "half.py");
    const stamp = new Date("2026-01-01T00:00:00Z");
    const check = {
      name: "test",
      command: 'python3 -c "from half import half; assert half(10) == 5"',
      kind: "test" as const,
    };
    const context = { dir, home: dir, timeoutMs: 30_000 };
    await writeFile(source, "def half(n):\n    return n / 3\n");
    await utimes(source, stamp, stamp);
    expect((await runCheck(check, context)).result.result).toBe("fail");
    await writeFile(source, "def half(n):\n    return n / 2\n");
    await utimes(source, stamp, stamp);
    expect((await runCheck(check, context)).result.result).toBe("pass");
  });
});
