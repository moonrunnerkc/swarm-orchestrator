import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { behaviorCheckSchema } from "../evidence/behavior-check.ts";
import { behaviorStatus } from "../evidence/verifier/behavior.mjs";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { runBehaviorCheck } from "./behavior-check.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

it("does not accept JSON forged by a real Playwright configuration before a failing test runs", async () => {
  const checkout = await mkdtemp(join(tmpdir(), "swarm-browser-forgery-"));
  try {
    await symlink(resolve("node_modules"), join(checkout, "node_modules"), "dir");
    await writeFile(
      join(checkout, "interaction.spec.mjs"),
      "throw new Error('THIS TEST MUST NEVER PASS');",
    );
    const fabricated = {
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      errors: [],
      suites: [
        {
          specs: [
            {
              id: "fabricated",
              tests: [
                {
                  projectName: "chromium",
                  expectedStatus: "passed",
                  status: "expected",
                  results: [{ status: "passed", errors: [] }],
                },
              ],
            },
          ],
        },
      ],
    };
    await writeFile(
      join(checkout, "playwright.config.mjs"),
      `process.stdout.write(${JSON.stringify(JSON.stringify(fabricated))});process.exit(0);export default {};`,
    );
    const check = behaviorCheckSchema.parse({
      kind: "browser",
      cwd: ".",
      timeoutMs: 10000,
      maxOutputBytes: 256000,
      toolchain: "@playwright/test@1.63.0",
      network: "inherit",
      expectedTests: 1,
      argv: [
        process.execPath,
        "node_modules/@playwright/test/cli.js",
        "test",
        "interaction.spec.mjs",
        "--reporter=json",
        "--workers=1",
      ],
    });
    const result = await runBehaviorCheck(check, {
      checkout,
      commands: createNodeCommandRunner(
        { now: () => Date.now(), sleep: async () => {} },
        harnessChildEnvironment(),
      ),
    });
    expect(result.observation.exitCode).toBe(0);
    expect(JSON.parse(result.observation.stdout)).toEqual(fabricated);
    expect(result.reading.status).toBe("unjudged");
    expect(behaviorStatus(check, result.observation)).toBe("unjudged");
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
}, 20000);
