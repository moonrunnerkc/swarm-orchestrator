import { configDefaults, defineConfig } from "vitest/config";

/**
 * The campaign clones third-party repositories under campaign/work and keeps their run bundles
 * under campaign/corpus. Both carry test files of their own, which are not this project's
 * suite and must not be collected as if they were. The evidence tree holds the hidden
 * acceptance tests written for other repositories' runners, for the same reason.
 */
export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "campaign/work/**",
      "campaign/corpus/**",
      "campaign/campaigns/**",
      "docs/evidence/**",
    ],
  },
});
