import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { runBehaviorCheck } from "./behavior-check.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

let checkout = "";
const commands = createNodeCommandRunner(
  { now: () => Date.now(), sleep: async () => {} },
  harnessChildEnvironment(),
);
beforeAll(async () => {
  checkout = await mkdtemp(join(tmpdir(), "swarm-browser-"));
  await symlink(resolve("node_modules"), join(checkout, "node_modules"), "dir");
  await writeFile(join(checkout, "package.json"), '{"type":"module"}');
  await writeFile(
    join(checkout, "playwright.config.mjs"),
    `export default { testDir: '.', use: { launchOptions: { executablePath: ${JSON.stringify(chromium.executablePath())} }, screenshot:'only-on-failure', trace:'retain-on-failure' }, timeout:3000 };`,
  );
});
afterAll(async () => {
  await rm(checkout, { recursive: true, force: true });
});
async function verifyTest(content: string) {
  await writeFile(join(checkout, "interaction.spec.mjs"), content);
  return runBehaviorCheck(
    {
      kind: "browser",
      cwd: ".",
      timeoutMs: 20000,
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
    },
    { commands, checkout },
  );
}
it("accepts a real browser interaction and rejects the same interaction with broken behavior", async () => {
  const source = (script: string) =>
    `import {test,expect} from '@playwright/test'; test('increments',async({page})=>{await page.setContent('<button>0</button><script>document.querySelector("button").onclick=()=>{${script}}<\\/script>');await page.getByRole('button').click();await expect(page.getByRole('button')).toHaveText('1',{timeout:300});});`;
  const good = await verifyTest(source('document.querySelector("button").textContent="1"'));
  expect(good.reading.status, good.observation.stderr + good.observation.stdout).toBe("accepted");
  const bad = await verifyTest(source('document.querySelector("button").textContent="2"'));
  expect(bad.reading.status).toBe("rejected");
  expect(bad.observation.stdout).toContain("toHaveText");
}, 45000);
it("refuses zero tests and runner startup failure", async () => {
  expect((await verifyTest("export const nothing = 1;")).reading.status).not.toBe("accepted");
  expect((await verifyTest("import 'nonexistent-test-dependency';")).reading.status).not.toBe(
    "accepted",
  );
}, 45000);
