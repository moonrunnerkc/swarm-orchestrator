import { configDefaults, defineConfig } from "vitest/config";

/**
 * The campaign clones third-party repositories under campaign/work and keeps their run bundles
 * under campaign/corpus. Both carry test files of their own, which are not this project's
 * suite and must not be collected as if they were. The evidence tree holds the hidden
 * acceptance tests written for other repositories' runners, for the same reason.
 */
/**
 * Two profiles, because one suite that takes a minute is a suite people stop running before a
 * commit. `unit` holds the tests that touch nothing outside the process; `integration` holds
 * the ones that spawn processes, clone repositories or drive worktrees. The default is still
 * everything, so `npm test` and `npm run gates` mean what they have always meant.
 *
 * Integration tests get an explicit budget rather than the default timeout: a suite that hangs
 * should fail with the name of what hung, not sit at whatever the runner's default happens to
 * be this major version.
 */
const integrationSuites = [
  "src/workers/**/*.test.ts",
  "src/gates/acceptance.test.ts",
  "src/gates/corpus-replay.test.ts",
  "src/gates/base-control.test.ts",
  "src/gates/behaviour-probe.test.ts",
  "src/gates/harness-reporting.test.ts",
  "src/gates/report-forgery.test.ts",
  "src/gates/killed-command.test.ts",
  "src/gates/node-command-runner.test.ts",
  "src/gates/git-workspace.test.ts",
  "src/evidence/redteam-adversarial.test.ts",
  "src/agent-run.test.ts",
  "src/agent-run-envelope.test.ts",
  "src/exec/run-process.test.ts",
  "src/exec/execution-mode.test.ts",
  "src/exec/execution-envelope-record.test.ts",
  "src/tools/shell-tool.test.ts",
  "src/select/calibrate.test.ts",
];

const notThisProjectsSuite = [
  ...configDefaults.exclude,
  // Everything under campaign/ is other projects' trees: clones, kept disagreement trees, mined
  // pull-request checkouts and the oracles carved out of them. Collecting any of it fails this
  // suite in somebody else's file, with "no test suite found" or a missing import of a module
  // this repository never had.
  //
  // This was three separate entries, added one at a time as each new subdirectory broke the
  // suite, which meant the next one broke it again: campaign/eval/** was added after a kept
  // clamp.test.mjs, and campaign/pr-tasks/** would have been added after a mined Deque.test.js.
  // One pattern states the rule the three were each standing in for.
  //
  // campaign/harness is the exception and the only one: it is this repository's own code, fifteen
  // test files that belong to this suite. Excluding all of campaign drops them and the suite
  // shrinks by a hundred tests while still reporting green, which is worse than the failure it
  // was fixing.
  "campaign/!(harness)/**",
  "docs/evidence/**",
];

const profile = process.env.SWARM_TEST_PROFILE;

export default defineConfig({
  test: {
    exclude:
      profile === "unit" ? [...notThisProjectsSuite, ...integrationSuites] : notThisProjectsSuite,
    ...(profile === "integration" ? { include: integrationSuites } : {}),
    // Long enough for a real clone and a real gate run, short enough that a hang is a failure
    // rather than a wait. Individual cases still narrow it where they know better.
    testTimeout: profile === "unit" ? 10_000 : 120_000,
  },
});
