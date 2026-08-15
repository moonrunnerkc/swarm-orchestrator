import { defineConfig } from "vitest/config";

/**
 * Pass-5 probes and closures live outside the default include. Run explicitly:
 *   npx vitest run --config redteam/pass5/vitest.config.ts
 */
export default defineConfig({
  root: new URL("../..", import.meta.url).pathname,
  test: {
    include: ["redteam/pass5/probe-*.ts", "redteam/pass5/closures.regression.ts"],
    testTimeout: 60_000,
  },
});
