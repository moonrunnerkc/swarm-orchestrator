import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { renderCiSummary } from "../evidence/ci-summary.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { assembleGateSet } from "./engine.ts";
import { describeGateSet } from "./gate-set-seal.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

it.each([false, true])(
  "preserves unavailable checks in seals and mixed-package reports (configured missing tool=%s)",
  async (configuredMissing) => {
    const repository = await mkdtemp(join(tmpdir(), "swarm-package-assessment-"));
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args],
        { cwd: repository, encoding: "utf8" },
      ).trim();
    try {
      for (const unit of ["tested", "empty"]) {
        await mkdir(join(repository, unit));
        await writeFile(
          join(repository, unit, "package.json"),
          JSON.stringify({
            scripts:
              unit === "tested"
                ? {
                    test: "node --test test.cjs",
                    ...(configuredMissing ? { typecheck: "swarm-typechecker-does-not-exist" } : {}),
                  }
                : {},
          }),
        );
      }
      await writeFile(
        join(repository, "tested/test.cjs"),
        "require('node:test').test('arithmetic',()=>require('node:assert/strict').equal(1+1,2));",
      );
      git("init", "-q");
      git("add", ".");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      const gateOptions = { packages: ["tested", "empty"] };
      const assembled = await assembleGateSet({
        workspaceRoot: repository,
        criteriaRef: base,
        gateOptions,
      });
      const seal = describeGateSet({
        ...assembled,
        criteriaRef: base,
        budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
        attemptCap: 0,
      });
      expect(seal.gates).toContainEqual(
        expect.objectContaining({ id: "tests:empty", source: "inspection", severity: "blocking" }),
      );
      const clock = createSystemClock();
      const result = await verifyIndependently({
        repositoryRoot: repository,
        baseCommit: base,
        patch: "",
        commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
        clock,
        gateOptions,
      });
      expect(result.checks.find((check) => check.id === "tests:tested")?.status).toBe("passed");
      for (const id of ["tests:empty", "typecheck:empty", "format:empty"]) {
        expect(result.checks.find((check) => check.id === id)).toMatchObject({
          status: "not-applicable",
          observation: { unavailable: expect.any(String) },
        });
      }
      if (configuredMissing) {
        const typecheck = result.checks.find((check) => check.id === "typecheck:tested");
        expect(typecheck?.status).toBe("not-applicable");
        expect(typecheck?.optionalAbsence).toBeUndefined();
      }
      expect(result.regression).toBe("unmeasured");
      expect(result.verified).toBe(false);
      const summary = renderCiSummary({
        result,
        source: {
          version: 1,
          mode: "branch",
          targetBase: base,
          comparisonBase: base,
          head: base,
          patchDigest: "sha256:fixture",
          repository: null,
          pullRequest: null,
          comparison: "exact",
        },
        executionTrust: "restricted",
        bundleDirectory: "fixture",
        assessmentDigest: "sha256:fixture",
      });
      expect(summary).toContain("tests\\:empty");
      expect(summary).toContain("not-applicable");
      expect(summary).toContain("declares no tests script");
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  },
);
