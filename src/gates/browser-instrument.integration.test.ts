import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { behaviorCheckSchema } from "../evidence/behavior-check.ts";
import { behaviorStatus } from "../evidence/verifier/behavior.mjs";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { containerRuntimeAvailable, createContainerBackend } from "../exec/container-backend.ts";
import { runBehaviorCheck } from "./behavior-check.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

it.skipIf(!containerRuntimeAvailable("docker"))(
  "isolates the sealed browser instrument from forged config, dependencies and test selection",
  async () => {
    const checkout = await mkdtemp(join(homedir(), ".swarm-browser-trust-"));
    const commands = createNodeCommandRunner(
      createSystemClock(),
      harnessChildEnvironment(),
      createContainerBackend({
        runtime: "docker",
        image: "swarm-upgrade-browser:20260927",
        workspaceRoot: checkout,
        user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      }),
    );
    const source = `import {test,expect} from '@playwright/test';import{readFile}from'node:fs/promises';test('increments',async({page})=>{await page.setContent(await readFile(process.env.SWARM_SUBJECT_DIRECTORY+'/app.html','utf8'));await page.getByRole('button').click();await expect(page.getByRole('button')).toHaveText('1',{timeout:200});});`;
    const check = behaviorCheckSchema.parse({
      kind: "browser",
      cwd: ".",
      timeoutMs: 10000,
      maxOutputBytes: 256000,
      toolchain: "@playwright/test@1.63.0",
      network: "inherit",
      expectedTests: 1,
      environment: { PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" },
      instrument: { source, titles: ["increments"] },
    });
    try {
      const forged = {
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
        errors: [],
        suites: [
          {
            specs: [
              {
                id: "fabricated",
                file: "instrument.spec.mjs",
                title: "increments",
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
      const poison = `process.stdout.write(${JSON.stringify(JSON.stringify(forged))});process.exit(0);`;
      await writeFile(join(checkout, "playwright.config.mjs"), poison);
      await writeFile(
        join(checkout, "interaction.spec.mjs"),
        "throw Error('candidate test must not load');",
      );
      await mkdir(join(checkout, "node_modules/@playwright/test"), { recursive: true });
      await writeFile(join(checkout, "node_modules/@playwright/test/cli.js"), poison);
      for (const value of [1, 2]) {
        await writeFile(
          join(checkout, "app.html"),
          `<button onclick="this.textContent='${value}'">0</button>`,
        );
        const result = await runBehaviorCheck(check, { commands, checkout });
        const expected = value === 1 ? "accepted" : "rejected";
        expect(result.reading.status, JSON.stringify(result)).toBe(expected);
        expect(behaviorStatus(check, result.observation)).toBe(expected);
        if (value === 2) expect(result.observation.stdout).toContain("toHaveText");
        expect(behaviorStatus(check, { ...result.observation, browserExecution: undefined })).toBe(
          "unjudged",
        );
      }
      await writeFile(
        join(checkout, "app.html"),
        `<button onclick="this.textContent='1'">0</button>`,
      );
      const wrongIdentity = await runBehaviorCheck(
        { ...check, instrument: { source, titles: ["different requirement"] } },
        { commands, checkout },
      );
      expect(wrongIdentity.reading.status).toBe("rejected");
      const imported = await runBehaviorCheck(
        {
          ...check,
          instrument: {
            source: "await import(process.env.SWARM_SUBJECT_DIRECTORY+'/playwright.config.mjs');",
            titles: ["increments"],
          },
        },
        { commands, checkout },
      );
      expect(imported.reading.status).toBe("unjudged");
      expect(imported.observation.stdout + imported.observation.stderr).toContain(
        "browser instrument refuses candidate modules",
      );
      const zero = await runBehaviorCheck(
        { ...check, instrument: { source: "export const noTests=1;", titles: ["increments"] } },
        { commands, checkout },
      );
      expect(zero.reading.status).toBe("unjudged");
      const missing = await runBehaviorCheck(
        { ...check, environment: { PLAYWRIGHT_BROWSERS_PATH: "/missing-browser" } },
        { commands, checkout },
      );
      expect(missing.reading.status).toBe("unjudged");
      const hanging = await runBehaviorCheck(
        {
          ...check,
          timeoutMs: 1000,
          instrument: {
            source:
              "import{test}from'@playwright/test';test('increments',async()=>{await new Promise(()=>{});});",
            titles: ["increments"],
          },
        },
        { commands, checkout },
      );
      expect(hanging.reading.status).toBe("rejected");
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  },
  60000,
);
