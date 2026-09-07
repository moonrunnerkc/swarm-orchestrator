#!/usr/bin/env node
/**
 * Every bundle a document calls verified must verify from a clone.
 *
 * This exists because that stopped being true and nothing noticed. A weight reduction moved
 * record payloads out of the tracked tree, 47 of 51 bundles stopped passing their own verifier,
 * and four of them were cited in the README and claims.md in words like "verify.mjs exit 0" and
 * "it verifies from where it sits". The nightly proof stayed green because it verifies one of the
 * four bundles whose payloads had been kept.
 *
 * A bulk archive nobody cites may keep its payloads outside the repository, restored with
 * scripts/restore-bundle-blobs.mjs. A cited one may not: a reader who follows a claim to its
 * evidence and gets an exit code of 1 has been told something false.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;

/** Each bundle with the document that calls it verified, so the list says why it is on the list. */
const cited = [
  ["docs/evidence/2026-09-02/gates-bonded", "README.md, claims.md: verify.mjs exit 0, 17 verdicts re-derived"],
  ["docs/evidence/2026-08-24/session", "claims.md: verifies from outside the workspace"],
  ["docs/evidence/2026-08-24/swarm/redundancy", "claims.md: it verifies from where it sits"],
  ["docs/evidence/2026-08-24/swarm/decomposition", "claims.md: and it verifies"],
  ["docs/evidence/2026-08-18/shakedown/bundles/task-08-file-set-amended", "claims.md: the file-set gate blocked until an amendment was recorded"],
  ["docs/evidence/2026-08-18/live-frontier", "README.md, and the nightly proof workflow"],
  ["docs/evidence/2026-08-18/live-local", "README.md"],
  ["docs/evidence/2026-08-23/calibration", "claims.md"],
  ["docs/evidence/2026-09-02/calibration/qwen38-mlx", "2026-09-02/run-report.md"],
  ["docs/evidence/2026-09-02/calibration/qwen36-first", "2026-09-02/run-report.md"],
  ["docs/evidence/2026-09-02/calibration/qwen36-second", "2026-09-02/run-report.md"],
  ["docs/evidence/2026-09-02/calibration/gemma4-mistral", "2026-09-02/run-report.md"],
  ["docs/evidence/2026-09-04/calibration/qwen36", "2026-09-04/calibration-report.md: verify with the verifier each carries, exit 0"],
  ["docs/evidence/2026-09-04/calibration/gemma4-mistral", "2026-09-04/calibration-report.md: verify with the verifier each carries, exit 0"],
];

let failed = 0;
for (const [bundle, why] of cited) {
  const directory = join(repositoryRoot, bundle);
  try {
    await run(process.execPath, ["verify.mjs"], { cwd: directory, maxBuffer: 32 * 1024 * 1024 });
    console.log(`  verified  ${bundle}`);
  } catch (cause) {
    failed += 1;
    const said = `${cause.stdout ?? ""}`
      .split("\n")
      .filter((line) => line.includes("FAIL") || line.startsWith("bundle "))
      .slice(0, 4)
      .join("\n            ");
    console.log(`  FAILED    ${bundle}\n            cited by ${why}\n            ${said}`);
  }
}

if (failed > 0) {
  console.error(
    `\n${failed} cited bundle(s) do not verify. A document calls each of these verified, so a\n` +
      "reader following the claim to its evidence is told something false. Restore the payloads\n" +
      "with scripts/restore-bundle-blobs.mjs, or stop citing the bundle.",
  );
  process.exit(1);
}
console.log(`\nall ${cited.length} cited bundles verify from this checkout`);
