/**
 * Live probe of coverageReportingCommand: does the harness believe it forced
 * process isolation while the child still runs shared and can author the artifact?
 *
 * Run: node redteam/pass4/probe-isolation.mjs
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const { coverageReportingCommand } = await import(
  join(root, "src/gates/coverage-artifact.ts")
);

const artifact = "/tmp/pass4-probe.lcov";

const bodies = [
  "node --test",
  "node --test --test-isolation=none",
  "NODE_OPTIONS=--test-isolation=none node --test --test-isolation=none",
  "node --test --test-isolation='none'",
  'node --test --test-isolation="none"',
  "node --test --test-isolation none",
  "node --test --test-isolation=none ",
  "node --test $(echo --test-isolation=none)",
  "node --test --test-isolation=$(echo none)",
  "node --test `echo --test-isolation=none`",
  "node --test --test-isolation=`echo none`",
  "node --test --test-isolation=${ISOLATION:-none}",
  "env NODE_OPTIONS=--test-isolation=none node --test",
  "node --test -- --test-isolation=none",
  "node --import ./preload.mjs --test --test-isolation=none",
  "node --require ./setup.cjs --test --test-isolation=none",
  "node --test --test-isolation=none && true",
  "node --test | cat",
  "vitest run",
  "node --test --test-reporter=spec",
  "node --test --experimental-test-coverage",
  "node --run test",
  "npm run test:unit",
  "node ./run-tests.mjs",
  "node --test --test-isolation=none --test-name-pattern=inside",
];

console.log("=== rewrite table ===");
for (const body of bodies) {
  const rewritten = coverageReportingCommand(body, artifact);
  const forced = rewritten?.includes("--test-isolation=process") ?? false;
  const stillNone = rewritten?.includes("none") ?? false;
  const declined = rewritten === null;
  console.log(
    JSON.stringify({
      body,
      declined,
      forced,
      stillNone,
      rewritten,
    }),
  );
}
