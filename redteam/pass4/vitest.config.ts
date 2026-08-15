import { defineConfig } from "vitest/config";

/**
 * The pass-4 closures live outside the default include on purpose, so running them is
 * explicit: `npx vitest run --config redteam/pass4/vitest.config.ts`.
 *
 * They assert the behaviour the harness should have after the holes are closed. Running
 * this file against the current tree is expected to fail: that is the finding.
 */
export default defineConfig({
  root: new URL("../..", import.meta.url).pathname,
  test: { include: ["redteam/pass4/closures.regression.ts"] },
});
