import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Long enough for a real clone and a real check run, short enough that a hang fails.
    testTimeout: 120_000,
    // Assistant worktrees, scratch space and dev workspaces are other trees, not this suite.
    exclude: [...configDefaults.exclude, ".claude/**", "scratchpad/**", ".swarm/**"],
  },
});
