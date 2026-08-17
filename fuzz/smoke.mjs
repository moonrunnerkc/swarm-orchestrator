/**
 * Runs every harness over its own corpus, once each, outside the fuzzer.
 *
 * A harness that throws on startup, or one whose build is stale, produces exactly the
 * output of a harness that ran for its whole budget and found nothing. This is the check
 * that tells those two apart, which is why the build command runs it before a fuzz round
 * rather than leaving it to be remembered.
 *
 *   node fuzz/smoke.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const harnesses = readdirSync(here)
  .filter((entry) => entry.endsWith(".fuzz.cjs"))
  .map((entry) => ({ name: entry.replace(".fuzz.cjs", ""), path: join(here, entry) }));

if (harnesses.length === 0) {
  console.error("fuzz/smoke: no harnesses found");
  process.exit(1);
}

let failures = 0;

for (const harness of harnesses) {
  const corpus = join(here, "corpus", harness.name);
  let seeds;
  try {
    seeds = readdirSync(corpus).map((entry) => join(corpus, entry));
  } catch (cause) {
    console.error(`fuzz/smoke: ${harness.name} has no corpus at ${corpus}: ${cause.message}`);
    failures += 1;
    continue;
  }

  let fuzz;
  try {
    ({ fuzz } = require(harness.path));
  } catch (cause) {
    console.error(`fuzz/smoke: ${harness.name} did not load: ${cause.message}`);
    failures += 1;
    continue;
  }

  for (const seed of seeds) {
    try {
      await fuzz(readFileSync(seed));
    } catch (cause) {
      console.error(`fuzz/smoke: ${harness.name} threw on ${seed}: ${cause.message}`);
      failures += 1;
    }
  }
  console.log(`fuzz/smoke: ${harness.name} ran ${seeds.length} seed(s)`);
}

if (failures > 0) {
  console.error(`fuzz/smoke: ${failures} failure(s)`);
  process.exit(1);
}
