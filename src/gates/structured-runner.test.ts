import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { structuredRunner } from "./structured-runner.ts";

/**
 * Inside the repository tree on purpose: the runner resolves vitest from the fixture's own
 * directory upward, and the repository's node_modules is the only installed vitest here.
 * `.swarm` is excluded from collection, so the fixture's test file is never run as ours.
 */
let fixture: string;

beforeEach(async () => {
  await mkdir(resolve(".swarm"), { recursive: true });
  fixture = await mkdtemp(join(resolve(".swarm"), "structured-runner-"));
  await writeFile(
    join(fixture, "package.json"),
    '{ "name": "f", "version": "1.0.0", "type": "module", "scripts": { "test": "vitest run" } }\n',
  );
});

afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

describe("the vitest runner", () => {
  /**
   * Four of sixteen rollout repositories had their whole suite read as "malformed runner
   * output": their tests logged, or their test script printed its own verdicts, into the same
   * stdout the JSON reporter used. The report now goes to a file, and only its bytes are stdout.
   */
  it("prints the report alone even when the suite writes to stdout, and keeps the exit code", async () => {
    await writeFile(
      join(fixture, "noisy.test.mjs"),
      'import { it, expect } from "vitest";\n' +
        'it("logs and passes", () => { console.log("NOISE"); process.stdout.write("more\\n"); expect(1).toBe(1); });\n' +
        'it("fails", () => { expect(2).toBe(3); });\n',
    );
    const argv = structuredRunner("vitest run");
    expect(argv).not.toBeNull();
    const ran = spawnSync(argv?.[0] ?? "", argv?.slice(1) ?? [], {
      cwd: fixture,
      encoding: "utf8",
    });

    expect(ran.status).toBe(1);
    const report = JSON.parse(ran.stdout) as { numTotalTests: number; numFailedTests: number };
    expect(report.numTotalTests).toBe(2);
    expect(report.numFailedTests).toBe(1);
    expect(ran.stdout).not.toContain("NOISE");
  });

  /**
   * The rollout's second finding: a report over 64 KiB arrived cut at exactly the pipe's
   * buffer, because the exit-time write was partial, and every large suite read as malformed.
   */
  it("prints a report larger than a pipe buffer whole", async () => {
    const cases = Array.from(
      { length: 700 },
      (_, index) =>
        `it("case number ${index} with a title long enough to fill the report", () => { expect(${index}).toBe(${index}); });`,
    ).join("\n");
    await writeFile(
      join(fixture, "large.test.mjs"),
      `import { it, expect } from "vitest";\n${cases}\n`,
    );
    const argv = structuredRunner("vitest run");
    const ran = spawnSync(argv?.[0] ?? "", argv?.slice(1) ?? [], {
      cwd: fixture,
      encoding: "utf8",
      maxBuffer: 64_000_000,
    });

    expect(ran.status).toBe(0);
    expect(ran.stdout.length).toBeGreaterThan(65_536);
    const report = JSON.parse(ran.stdout) as { numTotalTests: number; numPassedTests: number };
    expect(report.numTotalTests).toBe(700);
    expect(report.numPassedTests).toBe(700);
  });

  it("says so, as JSON, when vitest leaves no report", async () => {
    // No test files: vitest exits without writing a report the parser could read.
    const argv = structuredRunner("vitest");
    const ran = spawnSync(argv?.[0] ?? "", argv?.slice(1) ?? [], {
      cwd: fixture,
      encoding: "utf8",
    });
    const printed = JSON.parse(ran.stdout) as { unavailable?: string; numTotalTests?: number };
    expect(printed.unavailable !== undefined || printed.numTotalTests === 0).toBe(true);
  });
});
