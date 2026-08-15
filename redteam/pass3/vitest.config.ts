import { defineConfig } from "vitest/config";

/**
 * The pass-3 closures live outside the default include on purpose, so running them is
 * explicit: `npx vitest run --config redteam/pass3/vitest.config.ts`.
 */
export default defineConfig({
  root: new URL("../..", import.meta.url).pathname,
  test: { include: ["redteam/pass3/closures.regression.ts"] },
});
