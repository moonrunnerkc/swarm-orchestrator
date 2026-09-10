import { describe, expect, it } from "vitest";
import { npmFailureReason } from "./npm-failure.ts";

describe("npmFailureReason", () => {
  /**
   * npm puts the reason first and its usage banner last, and the viability filter was recording
   * the last 160 characters. Fifteen mined candidates were dropped carrying `ror\nnpm error Run
   * "npm help ci" for more info`, which names nothing anybody can act on.
   */
  it("takes the code and the reason, not the usage banner after them", () => {
    const stderr = [
      "npm error code EUSAGE",
      "npm error",
      "npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.",
      "npm error",
      "npm error Invalid: lock file's @types/inquirer@0.0.41 does not satisfy @types/inquirer@0.0.42",
      "npm error",
      "npm error Clean install a project",
      "npm error",
      "npm error Usage:",
      "npm error npm ci",
      'npm error Run "npm help ci" for more info',
    ].join("\n");

    const reason = npmFailureReason(stderr);

    expect(reason).toContain("EUSAGE");
    expect(reason).toContain("in sync");
    expect(reason).not.toContain("npm help ci");
  });

  it("reports a dependency resolution failure by its code", () => {
    const reason = npmFailureReason(
      ["npm error code ERESOLVE", "npm error ERESOLVE unable to resolve dependency tree"].join(
        "\n",
      ),
    );

    expect(reason).toContain("ERESOLVE");
  });

  // Not every failure is npm's own: a killed process or a missing binary writes something else,
  // and an empty answer would read as a failure with no cause at all.
  it("falls back to what was written where npm named no code", () => {
    expect(npmFailureReason("Killed: 9")).toContain("Killed");
    expect(npmFailureReason("")).toContain("no output");
  });
});
