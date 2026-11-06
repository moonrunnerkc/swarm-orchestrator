import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Dependency,
  versionConstraintsOf,
  workspaceDependencies,
} from "./version-constraints.ts";

const claimcheck: Dependency[] = [
  { name: "@stryker-mutator/core", ecosystem: "npm" },
  { name: "@stryker-mutator/vitest-runner", ecosystem: "npm" },
  { name: "@vitest/coverage-v8", ecosystem: "npm" },
  { name: "vitest", ecosystem: "npm" },
  { name: "typescript", ecosystem: "npm" },
];

describe("version constraints read from a task's wording", () => {
  it("reads claimcheck's task: vitest pinned, both Stryker packages to the latest 9.x", () => {
    const task =
      "Bump vitest from 4.1.8 to 4.1.10 (or both Stryker packages to the latest 9.x if one exists), update package-lock.json, and adapt any hard-coded version (strykerVersionFor in src/adapters/worktree-toolchain.ts) with a test.";
    const { constraints, notes } = versionConstraintsOf(task, claimcheck);
    expect(constraints).toEqual([
      {
        name: "vitest",
        ecosystem: "npm",
        range: "4.1.10",
        latest: false,
        wording: "vitest from 4.1.8 to 4.1.10",
      },
      {
        name: "@stryker-mutator/core",
        ecosystem: "npm",
        range: "9.x",
        latest: true,
        wording: "Stryker packages to the latest 9.x",
      },
      {
        name: "@stryker-mutator/vitest-runner",
        ecosystem: "npm",
        range: "9.x",
        latest: true,
        wording: "Stryker packages to the latest 9.x",
      },
    ]);
    expect(notes).toEqual([]);
  });

  it("reads dependency-detector's PyPI pin", () => {
    const task =
      "Bump pytest from 9.0.2 to 9.2.0 in pyproject.toml and uv.lock (uv lock --upgrade-package pytest), and adapt any code or test the upgrade breaks.";
    const { constraints } = versionConstraintsOf(task, [{ name: "pytest", ecosystem: "pypi" }]);
    expect(constraints).toEqual([
      {
        name: "pytest",
        ecosystem: "pypi",
        range: "9.2.0",
        latest: false,
        wording: "pytest from 9.0.2 to 9.2.0",
      },
    ]);
  });

  it("reads a caret, the newest of a major, and a pin named after the package", () => {
    const deps: Dependency[] = [
      { name: "react", ecosystem: "npm" },
      { name: "Django", ecosystem: "pypi" },
      { name: "lodash", ecosystem: "npm" },
    ];
    const read = (task: string) =>
      versionConstraintsOf(task, deps).constraints.map(({ name, range, latest }) => ({
        name,
        range,
        latest,
      }));
    expect(read("Upgrade react to ^19 and fix what breaks.")).toEqual([
      { name: "react", range: "^19", latest: false },
    ]);
    expect(read("Move django to the newest 5.x.")).toEqual([
      { name: "Django", range: "5.x", latest: true },
    ]);
    expect(read("Upgrade lodash and pin to 4.17.21.")).toEqual([
      { name: "lodash", range: "4.17.21", latest: false },
    ]);
  });

  it("reads nothing into wording that names no dependency version", () => {
    const deps: Dependency[] = [{ name: "better-sqlite3", ecosystem: "npm" }];
    const task =
      "Make the suite pass on Node 24: rebuild or bump better-sqlite3 within 12.x, set engines.node to >=22 <27, add .nvmrc, and add Node 24 to the CI matrix.";
    expect(versionConstraintsOf(task, deps).constraints).toEqual([
      {
        name: "better-sqlite3",
        ecosystem: "npm",
        range: "12.x",
        latest: false,
        wording: "better-sqlite3 within 12.x",
      },
    ]);
    expect(versionConstraintsOf("Add Node 24 to the CI matrix.", deps).constraints).toEqual([]);
  });

  it("says so when the named package is in no manifest, rather than guess its name", () => {
    const { constraints, notes } = versionConstraintsOf("Upgrade Prisma to 6.x.", claimcheck);
    expect(constraints).toEqual([]);
    expect(notes).toEqual([
      'the task names a version for "Prisma" (Prisma to 6.x), and no manifest here lists a package of that name, so the verifier does not hold the version',
    ]);
  });
});

describe("the workspace's declared dependencies", () => {
  it("reads package.json and pyproject.toml, every group", async () => {
    const dir = await mkdtemp(join(tmpdir(), "declared-dependencies-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { zod: "^4" }, devDependencies: { vitest: "^4.1.8" } }),
    );
    await writeFile(
      join(dir, "pyproject.toml"),
      [
        "[project]",
        'dependencies = ["requests>=2", "Flask[async] ==3.0"]',
        "[project.optional-dependencies]",
        'docs = ["sphinx"]',
        "[dependency-groups]",
        'dev = ["pytest==9.0.2", {include-group = "docs"}]',
      ].join("\n"),
    );
    expect((await workspaceDependencies(dir)).dependencies).toEqual([
      { name: "zod", ecosystem: "npm" },
      { name: "vitest", ecosystem: "npm" },
      { name: "requests", ecosystem: "pypi" },
      { name: "Flask", ecosystem: "pypi" },
      { name: "sphinx", ecosystem: "pypi" },
      { name: "pytest", ecosystem: "pypi" },
    ]);
  });
});

// claimcheck's upgrade (2026-11-05, rc.7 sealed-set run): only the name nearest "to" was held,
// so vitest and @stryker-mutator/core went unchecked.
describe("names joined in one version phrase", () => {
  it("are each held to its range, with the whole phrase as the wording", () => {
    const deps = [
      "vitest",
      "@vitest/coverage-v8",
      "@stryker-mutator/core",
      "@stryker-mutator/vitest-runner",
    ].map((name) => ({ name, ecosystem: "npm" as const }));
    const read = versionConstraintsOf(
      "Upgrade claimcheck to vitest 5: vitest and @vitest/coverage-v8 to ^5, then move @stryker-mutator/core and @stryker-mutator/vitest-runner to ^10 as well.",
      deps,
    );
    expect(read.constraints.map((one) => [one.name, one.range, one.wording])).toEqual([
      ["vitest", "^5", "vitest and @vitest/coverage-v8 to ^5"],
      ["@vitest/coverage-v8", "^5", "vitest and @vitest/coverage-v8 to ^5"],
      [
        "@stryker-mutator/core",
        "^10",
        "@stryker-mutator/core and @stryker-mutator/vitest-runner to ^10",
      ],
      [
        "@stryker-mutator/vitest-runner",
        "^10",
        "@stryker-mutator/core and @stryker-mutator/vitest-runner to ^10",
      ],
    ]);
  });
});
