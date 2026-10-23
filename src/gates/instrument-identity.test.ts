import { describe, expect, it } from "vitest";
import {
  authorizedWithin,
  instrumentChanges as offlineChanges,
  readStatus,
} from "../evidence/verifier/status.mjs";
import {
  type InstrumentObservation,
  type InstrumentTrees,
  instrumentChanges,
  instrumentObservationSchema,
  observationDigest,
  observeInstrument,
  readUnderInstrument,
} from "./instrument-identity.ts";

/** Two in-memory trees: the reference and the candidate, as path to contents. */
function trees(
  reference: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): InstrumentTrees {
  const changed = [...new Set([...Object.keys(reference), ...Object.keys(current)])].filter(
    (path) => reference[path] !== current[path],
  );
  return {
    reference: async (path) => reference[path] ?? null,
    current: async (path) => current[path] ?? null,
    changed,
    listed: new Set([...Object.keys(reference), ...Object.keys(current)]),
    installedRoot: null,
  };
}

const manifest = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ name: "w", scripts, ...extra })}\n`;

const npm = (script: string) => ({ command: `npm run --loglevel=error ${script}`, argv: null });
const vitestArgv = {
  command: "vitest",
  argv: ["node", "--input-type=module", "-e", "import('vitest')"],
};

async function changes(
  command: { command: string; argv: readonly string[] | null },
  reference: Record<string, string>,
  current: Record<string, string>,
) {
  const observation = await observeInstrument(command, trees(reference, current));
  expect(instrumentObservationSchema.parse(observation)).toEqual(observation);
  const live = instrumentChanges(observation);
  // The offline verifier's second implementation reaches the same decision from the record.
  expect(offlineChanges(JSON.parse(JSON.stringify(observation)))).toEqual(live);
  return live;
}

describe("what the instrument is", () => {
  const base = {
    "package.json": manifest({ test: "vitest run" }),
    "sum.js": "a",
    "sum.test.js": "t",
  };

  it("leaves source and test edits out of it", async () => {
    expect(await changes(vitestArgv, base, { ...base, "sum.js": "b", "sum.test.js": "u" })).toEqual(
      [],
    );
  });

  it("follows a configuration into the helper it imports, and into a helper that helper imports", async () => {
    const reference = {
      ...base,
      "vitest.config.ts": 'import { options } from "./config/options";\nexport default options;\n',
      "config/options.ts": 'export { options } from "../shared/deep.mjs";\n',
      "shared/deep.mjs": "export const options = {};\n",
    };
    expect(
      await changes(vitestArgv, reference, {
        ...reference,
        "shared/deep.mjs": "process.exit(0);\n",
      }),
    ).toEqual(["shared/deep.mjs"]);
  });

  it("follows any string naming a file in the tree, and a setup glob, whatever the file is called", async () => {
    const reference = {
      ...base,
      "vitest.config.mjs":
        'export default { test: { setupFiles: ["tools/prime.js"], globalSetup: "./support/*.mjs" } };\n',
      "tools/prime.js": "",
      "support/one.mjs": "",
    };
    expect(await changes(vitestArgv, reference, { ...reference, "tools/prime.js": "x" })).toEqual([
      "tools/prime.js",
    ]);
    expect(await changes(vitestArgv, reference, { ...reference, "support/two.mjs": "x" })).toEqual([
      "support/two.mjs",
    ]);
  });

  it("reads the scripts a package-manager command reaches, before and after hooks included", async () => {
    const reference = {
      "package.json": manifest({
        test: "npm run unit && npm run e2e",
        unit: "node --test",
        e2e: "true",
        dev: "vite",
      }),
    };
    const current = (scripts: Record<string, string>) => ({ "package.json": manifest(scripts) });
    expect(
      await changes(
        npm("test"),
        reference,
        current({
          test: "npm run unit && npm run e2e",
          unit: "node --test",
          e2e: "true",
          dev: "vite --open",
        }),
      ),
    ).toEqual([]);
    expect(
      await changes(
        npm("test"),
        reference,
        current({ test: "npm run unit && npm run e2e", unit: "echo ok", e2e: "true", dev: "vite" }),
      ),
    ).toEqual(["package.json#scripts.unit"]);
    expect(
      await changes(
        npm("test"),
        reference,
        current({
          test: "npm run unit && npm run e2e",
          unit: "node --test",
          e2e: "true",
          dev: "vite",
          pretest: "x",
        }),
      ),
    ).toEqual(["package.json#scripts.pretest"]);
    expect(
      await changes(npm("test"), reference, { ...reference, ".npmrc": "script-shell=./sh\n" }),
    ).toEqual([".npmrc"]);
  });

  it("counts the program an interpreter runs, never a file it is handed to check", async () => {
    const reference = {
      "package.json": manifest({ test: "node scripts/run.mjs", lint: "node --check sum.js" }),
      "scripts/run.mjs": "a",
      "sum.js": "a",
    };
    expect(await changes(npm("test"), reference, { ...reference, "scripts/run.mjs": "b" })).toEqual(
      ["scripts/run.mjs"],
    );
    expect(await changes(npm("lint"), reference, { ...reference, "sum.js": "b" })).toEqual([]);
  });

  it("reads the files a run program hands its tools by name as the source it measures, not the instrument", async () => {
    // pako's build: a program that gives vite and rollup its entries by string. The entries are
    // what the build measures; a change to them is the task, and putting them back to the
    // base's undid the change and refused a correct patch.
    const reference = {
      "package.json": manifest({ build: "node support/build.mjs" }),
      "support/build.mjs":
        "import { build } from 'vite';\nawait build({ build: { lib: { entry: 'src/index.ts' } } });\nfor (const [entry] of [[ 'src/inflate.ts', 'pako_inflate' ]]) await build({ entry });\n",
      "src/index.ts": "export * from './inflate.ts';\n",
      "src/inflate.ts": "export const ended = false;\n",
    };
    const current = { ...reference, "src/inflate.ts": "export const ended = true;\n" };
    expect(await changes(npm("build"), reference, current)).toEqual([]);
    const observation = await observeInstrument(npm("build"), trees(reference, current));
    expect(observation.residuals.join("\n")).toContain(
      "support/build.mjs names 2 file(s) in the tree by string without importing or running them (src/index.ts, src/inflate.ts)",
    );
    // The program itself is still the instrument.
    expect(
      await changes(npm("build"), reference, {
        ...reference,
        "support/build.mjs": "process.exit(0);\n",
      }),
    ).toEqual(["support/build.mjs"]);
  });

  it("reads a manifest reached inside the closure by field, not as a bag of strings naming the whole project", async () => {
    // sinon's shape, as the 2026-10-21 comparison found it: the eslint configuration lists the
    // build script among the files it lints, the build script requires package.json for its
    // version, and package.json's knip entries name src/sinon.js, which imports every source
    // file. Read as strings, the manifest made the project's whole source the lint check's
    // instrument, so a correct change to one source file withheld a passing lint, the gates
    // never read green, and the run escalated at an "unknown" gate with every check passing.
    const reference = {
      "package.json": manifest(
        { lint: "eslint .", "build-artifacts": "node ./build.cjs" },
        { knip: { entry: ["src/sinon.js"] } },
      ),
      "eslint.config.js":
        'export default [{ files: ["build.cjs", "src/**/*.js"], rules: { "no-underscore-dangle": "error" } }];\n',
      "build.cjs": 'const pkg = require("./package.json");\nconsole.log(pkg.version);\n',
      "src/sinon.js": 'import "./sinon/mock.js";\n',
      "src/sinon/mock.js": "export const mock = 1;\n",
    };
    const current = { ...reference, "src/sinon/mock.js": "export const mock = 2;\n" };
    expect(await changes(npm("lint"), reference, current)).toEqual([]);
    const observation = await observeInstrument(npm("lint"), trees(reference, current));
    expect(observation.files.map((file) => file.path)).not.toContain("src/sinon/mock.js");
    expect(observation.files.map((file) => file.path)).not.toContain("src/sinon.js");
    // The manifest's own script is still the instrument, and so is the configuration.
    expect(
      await changes(npm("lint"), reference, {
        ...reference,
        "package.json": manifest(
          { lint: "eslint . --quiet", "build-artifacts": "node ./build.cjs" },
          { knip: { entry: ["src/sinon.js"] } },
        ),
      }),
    ).toContain("package.json#scripts.lint");
    expect(
      await changes(npm("lint"), reference, {
        ...reference,
        "eslint.config.js": "export default [];\n",
      }),
    ).toEqual(["eslint.config.js"]);
    // The same manifest reached through a test command's pre-hook: sinon's `npm run test-node`
    // runs the build script first, which requires package.json. A source change with a new
    // regression test then read "passes only under this patch's changes to the runner
    // configuration", and a complete source-and-test change exited as unmeasured.
    const withTests = {
      ...reference,
      "package.json": manifest(
        {
          "test-node": "mocha test",
          "pretest-node": "npm run build-artifacts",
          "build-artifacts": "node ./build.cjs",
        },
        { knip: { entry: ["src/sinon.js"] } },
      ),
    };
    expect(
      await changes(npm("test-node"), withTests, {
        ...withTests,
        "src/sinon/mock.js": "export const mock = 2;\n",
      }),
    ).toEqual([]);
    expect(
      await changes(npm("test-node"), withTests, {
        ...withTests,
        "build.cjs": "process.exit(1);\n",
      }),
    ).toEqual(["build.cjs"]);
  });

  it("follows what a run program imports, and what it names where it runs processes or loads by computed name", async () => {
    const reference = {
      "package.json": manifest({
        test: "node scripts/run.mjs",
        spawn: "node scripts/spawn.mjs",
        load: "node scripts/load.mjs",
      }),
      "scripts/run.mjs": "import { report } from './report.mjs';\nreport();\n",
      "scripts/report.mjs": "export const report = () => {};\n",
      "scripts/spawn.mjs":
        "import { spawnSync } from 'node:child_process';\nprocess.exit(spawnSync('node', ['scripts/child.mjs']).status);\n",
      "scripts/child.mjs": "process.exit(1);\n",
      "scripts/load.mjs": "const name = './plugin.mjs';\nawait import(name);\n",
      "scripts/plugin.mjs": "",
    };
    expect(
      await changes(npm("test"), reference, {
        ...reference,
        "scripts/report.mjs": "process.exit(0);\n",
      }),
    ).toEqual(["scripts/report.mjs"]);
    expect(
      await changes(npm("spawn"), reference, {
        ...reference,
        "scripts/child.mjs": "process.exit(0);\n",
      }),
    ).toEqual(["scripts/child.mjs"]);
    expect(
      await changes(npm("load"), reference, { ...reference, "scripts/plugin.mjs": "x" }),
    ).toEqual(["scripts/plugin.mjs"]);
  });

  it("follows a configuration's strings into a file a run program also names, as configuration", async () => {
    const reference = {
      "package.json": manifest({ test: "node scripts/run.mjs && vitest run" }),
      "scripts/run.mjs": "console.log('tools/prime.js');\n",
      "vitest.config.mjs": 'export default { test: { setupFiles: ["tools/prime.js"] } };\n',
      "tools/prime.js": "",
    };
    expect(await changes(npm("test"), reference, { ...reference, "tools/prime.js": "x" })).toEqual([
      "tools/prime.js",
    ]);
  });

  it("follows a conftest into the local modules it imports and the plugins it names", async () => {
    const pytest = { command: "pytest", argv: ["python", "-c", "import pytest"] };
    const reference = {
      "pyproject.toml": '[project]\nname = "w"\n[tool.pytest.ini_options]\naddopts = "-q"\n',
      "tests/conftest.py": "from tests.helpers import fixture\npytest_plugins = ['tests.plug']\n",
      "tests/helpers.py": "",
      "tests/plug.py": "",
      "tests/test_x.py": "",
    };
    expect(
      await changes(pytest, reference, {
        ...reference,
        "tests/helpers.py": "x",
        "tests/test_x.py": "y",
      }),
    ).toEqual(["tests/helpers.py"]);
    expect(await changes(pytest, reference, { ...reference, "tests/plug.py": "x" })).toEqual([
      "tests/plug.py",
    ]);
    expect(
      await changes(pytest, reference, {
        ...reference,
        "pyproject.toml":
          '[project]\nname = "w"\nversion = "2"\n[tool.pytest.ini_options]\naddopts = "-q"\n',
      }),
    ).toEqual([]);
    expect(
      await changes(pytest, reference, {
        ...reference,
        "pyproject.toml":
          '[project]\nname = "w"\n[tool.pytest.ini_options]\naddopts = "-q -p no:cacheprovider --deselect tests"\n',
      }),
    ).toEqual(["pyproject.toml#tool.pytest"]);
    expect(await changes(pytest, reference, { ...reference, "sub/conftest.py": "x" })).toEqual([
      "sub/conftest.py",
    ]);
  });
});

describe("what a configuration lists as the files it checks", () => {
  // The minimal case the 2026-10-21 accessor run reduced to: a lint configuration names one
  // source file, by its literal path, among the files it lints. The configuration is unchanged,
  // the source file changes, lint passes, and the pass was withheld because the file was read
  // as part of the instrument. A file a tool checks is the subject of the check; what the tool
  // loads to perform it (configuration, plugins, processors, parsers, reporters, setup files,
  // programs run) is the instrument.
  const lint = {
    "package.json": manifest({ lint: "eslint ." }),
    "eslint.config.js":
      'export default [{ files: ["src/sum.js"], ignores: ["src/legacy.js"], rules: { "no-debugger": "error" } }];\n',
    "src/sum.js": "export const sum = (a, b) => a + b;\n",
    "src/legacy.js": "export const old = 1;\n",
  };

  it("leaves a source file a lint configuration lists by literal path out of the instrument", async () => {
    const current = { ...lint, "src/sum.js": "export const sum = (a, b) => a + b + 0;\n" };
    expect(await changes(npm("lint"), lint, current)).toEqual([]);
    const observation = await observeInstrument(npm("lint"), trees(lint, current));
    expect(observation.files.map((file) => file.path)).toEqual([
      "eslint.config.js",
      "package.json#scripts.lint",
    ]);
    expect(observation.residuals).toContain(
      "eslint.config.js names 2 file(s) in the tree as what its tool checks (src/legacy.js, src/sum.js); they are the subject of the check, not the instrument, and not followed",
    );
    // An ignored file is the subject too, by the same token.
    expect(await changes(npm("lint"), lint, { ...lint, "src/legacy.js": "x" })).toEqual([]);
  });

  it("leaves files a configuration selects by pattern out of it, for the supported tools", async () => {
    const cases: [string, Record<string, string>, string][] = [
      [
        "eslint",
        {
          "package.json": manifest({ lint: "eslint ." }),
          "eslint.config.mjs":
            'export default [{ files: ["src/**/*.js", "tools/build.cjs"], ignores: ["dist/**"] }];\n',
        },
        "lint",
      ],
      [
        "mocha",
        {
          "package.json": manifest({ test: "mocha" }),
          ".mocharc.json": '{ "spec": ["test/**/*.js", "test/run.js"], "extension": ["js"] }\n',
        },
        "test",
      ],
      [
        "vitest",
        {
          "package.json": manifest({ test: "vitest run" }),
          "vitest.config.mjs":
            'export default { test: { include: ["src/**/*.spec.js", "tools/build.cjs"], exclude: ["src/x.js"], coverage: { include: ["src/**"] } } };\n',
        },
        "test",
      ],
      [
        "jest",
        {
          "package.json": manifest({ test: "jest" }),
          "jest.config.js":
            'module.exports = { roots: ["<rootDir>/src"], testMatch: ["**/tools/build.cjs"], collectCoverageFrom: ["src/**/*.js", "tools/build.cjs"] };\n',
        },
        "test",
      ],
      [
        "tsc",
        {
          "package.json": manifest({ typecheck: "tsc -p tsconfig.json" }),
          "tsconfig.json":
            '{ "compilerOptions": { "strict": true }, "files": ["tools/build.cjs", "src/x.js"], "include": ["src/**/*"] }\n',
        },
        "typecheck",
      ],
      [
        "nyc",
        {
          "package.json": manifest({ test: "nyc mocha" }),
          ".nycrc.json":
            '{ "include": ["src/**", "tools/build.cjs"], "exclude": ["src/x.js"], "all": true }\n',
        },
        "test",
      ],
    ];
    for (const [tool, files, script] of cases) {
      const reference = {
        ...files,
        "tools/build.cjs": "module.exports = 1;\n",
        "src/x.js": "export const x = 1;\n",
      };
      for (const path of ["tools/build.cjs", "src/x.js"])
        expect(
          await changes(npm(script), reference, { ...reference, [path]: "changed" }),
          `${tool}: ${path}`,
        ).toEqual([]);
    }
  });

  it("still follows what a configuration loads: parsers, processors, plugins, reporters, setup and the configuration itself", async () => {
    const reference = {
      "package.json": manifest({ lint: "eslint .", test: "mocha", check: "vitest run" }),
      ".eslintrc.json":
        '{ "overrides": [{ "files": ["src/sum.js"], "parser": "./tools/parser.js", "processor": "./tools/processor.js" }], "extends": ["./tools/base.json"] }\n',
      ".mocharc.json":
        '{ "spec": ["test/a.js"], "require": "./tools/setup.js", "reporter": "./tools/reporter.js", "file": ["./tools/first.js"] }\n',
      "vitest.config.mjs":
        'export default { test: { include: ["src/**/*.spec.js"], setupFiles: ["tools/prime.js"] } };\n',
      "tools/parser.js": "",
      "tools/processor.js": "",
      "tools/base.json": "{}",
      "tools/setup.js": "",
      "tools/reporter.js": "",
      "tools/first.js": "",
      "tools/prime.js": "",
      "src/sum.js": "",
      "test/a.js": "",
    };
    for (const [script, path] of [
      ["lint", "tools/parser.js"],
      ["lint", "tools/processor.js"],
      ["lint", "tools/base.json"],
      ["lint", ".eslintrc.json"],
      ["test", "tools/setup.js"],
      ["test", "tools/reporter.js"],
      ["test", "tools/first.js"],
      ["test", ".mocharc.json"],
      ["check", "tools/prime.js"],
      ["check", "vitest.config.mjs"],
    ] as const)
      expect(await changes(npm(script), reference, { ...reference, [path]: "x" }), path).toEqual([
        path,
      ]);
    for (const [script, path] of [
      ["lint", "src/sum.js"],
      ["test", "test/a.js"],
    ] as const)
      expect(await changes(npm(script), reference, { ...reference, [path]: "x" }), path).toEqual(
        [],
      );
  });

  it("reads sinon's lint configuration as listing what it lints, so a source change leaves the lint instrument alone", async () => {
    // sinon at 8c663edec, the accessor task's base, reduced to the shape that mattered: the flat
    // configuration lists build.cjs and four test helpers among the files it lints by literal
    // path; build.cjs requires package.json and runs rollup over rollup.config.mjs, which lists
    // src at run time and names the bundle entries; src/sinon.js imports every module. Followed
    // from the lint configuration as loaded code, that chain put the project's whole source into
    // the lint instrument, and a change to two source files withheld a passing lint, then the
    // base-configuration rerun restored those two files and the run's own new tests failed.
    const reference = {
      "package.json": manifest({
        "build-artifacts": "node ./build.cjs",
        "pretest-node": "npm run build-artifacts",
        "test-node": 'mocha --recursive -R dot "test/{src,issues,scripts}/**/*-test.js"',
        lint: "eslint --max-warnings 0 '**/*.{js,cjs,mjs}'",
      }),
      "eslint.config.js": sinonLintConfiguration,
      "build.cjs":
        'const { execFileSync } = require("node:child_process");\nconst pkg = require("./package.json");\nexecFileSync(process.execPath, [require.resolve("rollup/dist/bin/rollup"), "-c", "rollup.config.mjs"], { stdio: "inherit" });\nconsole.log(pkg.version);\n',
      "rollup.config.mjs":
        'import fs from "node:fs";\nfunction getAllFiles(dir) { return fs.readdirSync(dir); }\nexport default { input: getAllFiles("src"), output: { dir: "lib" } };\n',
      "src/sinon.js": 'import "./sinon/stub.js";\nimport "./sinon/default-behaviors.js";\n',
      "src/sinon/stub.js": 'import "./default-behaviors.js";\nexport const stub = 1;\n',
      "src/sinon/default-behaviors.js": "export const get = 1;\n",
      "src/sinon/util/core/walk.js": "export const walk = 1;\n",
      "test/src/stub-test.js": "describe('stub', () => {});\n",
      "test/src/shared-spy-stub-everything-tests.js": "export const shared = 1;\n",
      "test/webworker/webworker-script.js": "onmessage = () => {};\n",
    };
    const accessorPatch = {
      ...reference,
      "src/sinon/default-behaviors.js": "export const get = 2;\n",
      "src/sinon/stub.js": 'import "./default-behaviors.js";\nexport const stub = 2;\n',
      "test/src/stub-test.js": "describe('stub', () => { it('getter', () => {}); });\n",
    };
    expect(await changes(npm("lint"), reference, accessorPatch)).toEqual([]);
    expect(await changes(npm("test-node"), reference, accessorPatch)).toEqual([]);
    const observation = await observeInstrument(npm("lint"), trees(reference, accessorPatch));
    expect(
      observation.files.map((file) => file.path).filter((path) => path.startsWith("src/")),
    ).toEqual([]);
    expect(observation.files.map((file) => file.path)).not.toContain("build.cjs");
    // Checking machinery still reads as the instrument: the configuration, and the build the
    // test command runs first.
    expect(
      await changes(npm("lint"), reference, {
        ...accessorPatch,
        "eslint.config.js": sinonLintConfiguration.replace('"src/**/*.js",', ""),
      }),
    ).toEqual(["eslint.config.js"]);
    expect(
      await changes(npm("test-node"), reference, {
        ...accessorPatch,
        "build.cjs": "process.exit(0);\n",
      }),
    ).toEqual(["build.cjs"]);
  });
});

/** sinon's eslint.config.js at 8c663edec, verbatim. */
const sinonLintConfiguration = `import noPrototypeMethods from "@sinonjs/eslint-plugin-no-prototype-methods";
import sinonConfig from "@sinonjs/eslint-config";

export default [
    {
        ignores: [
            "eslint.config.js",
            "coverage/**",
            ".worktrees/**",
            "**/.worktrees/**",
            "out/**",
            "pkg/**",
            "lib/**",
            "tmp/**",
            "**/node_modules/**",
            "docs/**",
            "vendor/**",
            "rollup.config.js",
        ],
    },
    ...sinonConfig,
    {
        plugins: {
            "@sinonjs/no-prototype-methods": noPrototypeMethods,
        },
        rules: {
            "@sinonjs/no-prototype-methods/no-prototype-methods": "error",
            "jsdoc/require-param-type": "off",
            "jsdoc/require-jsdoc": "off",
            "jsdoc/tag-lines": "off",
        },
    },
    {
        files: [
            "src/**/*.js",
            "test/src/**/*.js",
            "*.mjs",
            "**/*.mjs",
            "scripts/**/*.mjs",
            "test/distribution/browser-global-smoke.js",
            "test/es2015/check-esm-bundle-is-runnable.js",
        ],
        languageOptions: {
            sourceType: "module",
        },
        rules: {
            "no-underscore-dangle": [
                "error",
                {
                    allow: ["__dirname"],
                },
            ],
        },
    },
    {
        files: ["test/webworker/webworker-support-assessment.js"],
        languageOptions: {
            globals: {
                describe: false,
                it: false,
                Worker: false,
            },
        },
    },
    {
        files: ["test/webworker/webworker-script.js"],
        languageOptions: {
            globals: {
                importScripts: false,
                onmessage: false,
                postMessage: false,
                sinon: false,
            },
        },
    },
    {
        files: [
            "build.cjs",
            "scripts/**/*.mjs",
            "test/distribution/browser-global-smoke.js",
            "test/es2015/check-esm-bundle-is-runnable.js",
        ],
        rules: {
            "no-console": "off",
            "no-implicit-globals": "off",
        },
    },
    {
        files: ["*.cjs"],
        languageOptions: {
            sourceType: "script",
        },
    },
    {
        files: ["**/*-test.js", "test/**/*.js"],
        rules: {
            "@sinonjs/no-prototype-methods/no-prototype-methods": "off",
            "max-nested-callbacks": "off",
        },
    },
    {
        files: ["**/*-tests.*"],
        rules: {
            "@sinonjs/no-prototype-methods/no-prototype-methods": "off",
            "max-nested-callbacks": "off",
        },
    },
    {
        files: ["test/src/shared-spy-stub-everything-tests.js"],
        rules: {
            "mocha/no-exports": "off",
        },
    },
    {
        files: [
            "src/sinon/util/core/walk-object.js",
            "src/sinon/util/core/walk.js",
        ],
        rules: {
            "no-implicit-globals": "off",
        },
    },
];
`;

describe("where the runner comes from", () => {
  const lock = (entries: Record<string, unknown>) =>
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...entries } });
  const registry = (name: string, version: string, dependencies: Record<string, string> = {}) => ({
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`,
    integrity: "sha512-x",
    dependencies,
  });
  const reference = {
    "package.json": manifest({ test: "vitest run" }, { devDependencies: { vitest: "4.1.0" } }),
    "package-lock.json": lock({
      "node_modules/vitest": registry("vitest", "4.1.0", { tinypool: "^1" }),
      "node_modules/tinypool": registry("tinypool", "1.0.0"),
      "node_modules/lodash": registry("lodash", "4.0.0"),
    }),
  };

  it("trusts a registry release at another version, and a change to a dependency the runner does not load", async () => {
    expect(
      await changes(vitestArgv, reference, {
        ...reference,
        "package-lock.json": lock({
          "node_modules/vitest": registry("vitest", "4.1.1", { tinypool: "^1" }),
          "node_modules/tinypool": registry("tinypool", "1.0.1"),
          "node_modules/lodash": { version: "4.0.0", resolved: "https://evil.example/lodash.tgz" },
        }),
      }),
    ).toEqual([]);
  });

  it("does not trust a runner dependency from outside the registry, or renamed on the way", async () => {
    expect(
      await changes(vitestArgv, reference, {
        ...reference,
        "package-lock.json": lock({
          "node_modules/vitest": registry("vitest", "4.1.0", { tinypool: "^1" }),
          "node_modules/tinypool": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/evil/-/evil-1.0.0.tgz",
            integrity: "sha512-y",
          },
          "node_modules/lodash": registry("lodash", "4.0.0"),
        }),
      }),
    ).toEqual(["dependency node_modules/tinypool"]);
  });

  it("does not trust a pnpm or uv lockfile change that adds a tarball, path or git source", async () => {
    const pnpm = {
      "package.json": manifest({ test: "vitest run" }),
      "pnpm-lock.yaml": "packages:\n  vitest@4.1.0:\n    resolution: {integrity: sha512-x}\n",
    };
    expect(
      await changes(vitestArgv, pnpm, {
        ...pnpm,
        "pnpm-lock.yaml": `${pnpm["pnpm-lock.yaml"]}  vitest@4.1.1:\n    resolution: {integrity: sha512-z}\n`,
      }),
    ).toEqual([]);
    expect(
      await changes(vitestArgv, pnpm, {
        ...pnpm,
        "pnpm-lock.yaml": `${pnpm["pnpm-lock.yaml"]}  fake@1.0.0:\n    resolution: {tarball: https://evil.example/fake.tgz}\n`,
      }),
    ).toEqual(["dependency pnpm-lock.yaml"]);
    const pytest = { command: "pytest", argv: ["python", "-c", "import pytest"] };
    const uv = (source: string) => ({
      "uv.lock": `version = 1\n\n[[package]]\nname = "pytest"\nversion = "8.0.0"\nsource = ${source}\n`,
    });
    expect(
      await changes(
        pytest,
        uv('{ registry = "https://pypi.org/simple" }'),
        uv('{ registry = "https://pypi.org/simple" }\n# 8.0.1'),
      ),
    ).toEqual([]);
    expect(
      await changes(
        pytest,
        uv('{ registry = "https://pypi.org/simple" }'),
        uv('{ path = "vendor/pytest" }'),
      ),
    ).toEqual(["dependency pytest"]);
  });

  it("does not trust a runner the manifest now takes from a path or another package's name", async () => {
    const current = (spec: string) => ({
      ...reference,
      "package.json": manifest({ test: "vitest run" }, { devDependencies: { vitest: spec } }),
    });
    expect(await changes(vitestArgv, reference, current("4.1.1"))).toEqual([]);
    expect(await changes(vitestArgv, reference, current("file:./vendor/vitest"))).toEqual([
      "package.json#devDependencies:vitest",
    ]);
    expect(await changes(vitestArgv, reference, current("npm:not-vitest@1"))).toEqual([
      "package.json#devDependencies:vitest",
    ]);
  });
});

describe("the decision", () => {
  const clean: InstrumentObservation = {
    rule: "instrument-identity-v1",
    tools: ["vitest"],
    files: [
      {
        path: "vitest.config.mjs",
        reference: `sha256:${"a".repeat(64)}`,
        current: `sha256:${"a".repeat(64)}`,
      },
    ],
    dependencies: [],
    installed: [{ name: "vitest", expected: "4.1.11", found: "4.1.11", linked: true }],
    complete: true,
    residuals: [],
  };
  const passed = { status: "passed" as const, detail: "1 passed" };
  const [config] = clean.files;
  const [runner] = clean.installed;

  it("withholds a pass under a changed, unfinished, re-linked, reinstalled or mid-run rewritten instrument, never a failure", () => {
    const cases: readonly [InstrumentObservation, string][] = [
      [
        {
          ...clean,
          files: [
            { ...(config as NonNullable<typeof config>), current: `sha256:${"b".repeat(64)}` },
          ],
        },
        "vitest.config.mjs",
      ],
      [{ ...clean, complete: false }, "instrument closure not followed to its end"],
      [
        { ...clean, installed: [{ ...(runner as NonNullable<typeof runner>), linked: false }] },
        "installed vitest executable link",
      ],
      [
        { ...clean, installed: [{ ...(runner as NonNullable<typeof runner>), found: "0.0.1" }] },
        "installed vitest 0.0.1 (lockfile 4.1.11)",
      ],
      [
        { ...clean, before: `sha256:${"c".repeat(64)}` },
        "the instrument changed while the check ran",
      ],
    ];
    expect(readUnderInstrument(passed, clean)).toEqual(passed);
    expect(readUnderInstrument(passed, { ...clean, before: observationDigest(clean) })).toEqual(
      passed,
    );
    for (const [observation, reason] of cases) {
      expect(instrumentChanges(observation)).toEqual([reason]);
      expect(offlineChanges(JSON.parse(JSON.stringify(observation)))).toEqual([reason]);
      expect(readUnderInstrument(passed, observation).status).toBe("not-applicable");
      expect(
        readUnderInstrument({ status: "failed" as const, detail: "x" }, observation).status,
      ).toBe("failed");
      const record = {
        exitCode: 0,
        stdout: "",
        stderr: "",
        unavailable: null,
        instrument: observation,
      };
      expect(readStatus("exit-code", record)).toBe("not-applicable");
      expect(readStatus("exit-code", { ...record, instrument: clean })).toBe("passed");
    }
  });
});

describe("an authorized instrument difference", () => {
  const observation = (authorized?: readonly string[]): InstrumentObservation => ({
    rule: "instrument-identity-v1",
    tools: ["node-test"],
    files: [
      {
        path: "package.json",
        reference: `sha256:${"a".repeat(64)}`,
        current: `sha256:${"b".repeat(64)}`,
      },
      {
        path: "package.json#scripts.test",
        reference: `sha256:${"c".repeat(64)}`,
        current: `sha256:${"c".repeat(64)}`,
      },
    ],
    dependencies: [],
    installed: [],
    complete: true,
    residuals: [],
    ...(authorized === undefined ? {} : { authorized }),
  });

  it("is not a change where the observation names the path as the task's own", () => {
    const authorized = observation(["package-lock.json", "package.json"]);
    expect(instrumentObservationSchema.parse(authorized)).toEqual(authorized);
    expect(instrumentChanges(authorized)).toEqual([]);
    expect(offlineChanges(JSON.parse(JSON.stringify(authorized)))).toEqual([]);
    expect(instrumentChanges(observation())).toEqual(["package.json"]);
    expect(offlineChanges(JSON.parse(JSON.stringify(observation())))).toEqual(["package.json"]);
  });

  it("is carried on the observation itself, where a manifest a program reads differs", async () => {
    const reference = {
      "package.json": manifest({ build: "node build.cjs" }, { dependencies: { left: "1.0.0" } }),
      "build.cjs": "require('./package.json');",
    };
    const current = {
      ...reference,
      "package.json": manifest({ build: "node build.cjs" }, { dependencies: { left: "2.0.0" } }),
    };
    const plain = await observeInstrument(npm("build"), trees(reference, current));
    expect(plain.files.map((file) => file.path)).toContain("package.json");
    expect(instrumentChanges(plain)).toEqual(["package.json"]);
    const upgrade = await observeInstrument(npm("build"), trees(reference, current), {
      authorized: ["package.json", "package-lock.json"],
    });
    expect(upgrade.authorized).toEqual(["package-lock.json", "package.json"]);
    expect(instrumentObservationSchema.parse(upgrade)).toEqual(upgrade);
    expect(instrumentChanges(upgrade)).toEqual([]);
    expect(offlineChanges(JSON.parse(JSON.stringify(upgrade)))).toEqual([]);
  });

  it("is allowed by the bundled verifier only under an upgrade preset's own manifest and lockfile", () => {
    const checks = [{ id: "tests", instrument: observation(["package.json"]) }];
    expect(authorizedWithin(checks, ["package.json", "package-lock.json"])).toBe(true);
    expect(authorizedWithin(checks, [])).toBe(false);
    expect(authorizedWithin([{ id: "tests", instrument: observation() }], [])).toBe(true);
    expect(
      authorizedWithin(
        [{ id: "tests", instrument: observation(), configurationInstrument: observation(["x"]) }],
        ["package.json"],
      ),
    ).toBe(false);
  });
});

describe("a lifecycle alias of a package script", () => {
  it("is the script it runs, so a test script replaced by a printed pass is the instrument", async () => {
    const reference = { "package.json": manifest({ test: "node --test" }), "a.test.js": "t" };
    const forged = {
      ...reference,
      "package.json": manifest({ test: "echo '# pass 12' && echo '# fail 0'" }),
    };
    for (const command of ["npm test", "npm t", "pnpm test", "yarn test", "npm --silent test"])
      expect(await changes({ command, argv: null }, reference, forged)).toEqual([
        "package.json#scripts.test",
      ]);
  });
});

describe("a configuration change that only follows the patch's renames", () => {
  const lint = (ignored: string, extra = "") =>
    `module.exports = [{ ignores: ['${ignored}', 'test/types/import.js'] }${extra}]\n`;
  const reference = {
    "package.json": manifest({ lint: "eslint" }),
    "eslint.config.js": lint("lib/configValidator.js"),
    "lib/configValidator.js": "// generated\nmodule.exports = {}\n",
  };
  const renamed = {
    "package.json": manifest({ lint: "eslint" }),
    "eslint.config.js": lint("lib/config-validator.js"),
    "lib/config-validator.js": "// generated\nmodule.exports = {}\n",
  };

  it("is the base's instrument with its references moved, and the verifier reads it the same way", async () => {
    expect(await changes(npm("lint"), reference, renamed)).toEqual([]);
    const observation = await observeInstrument(npm("lint"), trees(reference, renamed));
    expect(observation.transport?.renames.map(({ from, to }) => [from, to])).toEqual([
      ["lib/configValidator.js", "lib/config-validator.js"],
    ]);
    expect(observation.files.find((file) => file.path === "eslint.config.js")).toMatchObject({
      transported: true,
    });
  });

  it.each([
    ["a rule switched off", lint("lib/config-validator.js", ", { rules: { 'no-undef': 'off' } }")],
    ["the whole library ignored", lint("lib/")],
    ["an ignore entry moved to a file nothing renamed", lint("lib/fastify.js")],
  ])("stays the instrument when the change also has %s", async (_name, edited) => {
    expect(
      await changes(npm("lint"), reference, { ...renamed, "eslint.config.js": edited }),
    ).toEqual(["eslint.config.js"]);
  });

  it("stays the instrument when the renamed file is not the file it was", async () => {
    expect(
      await changes(npm("lint"), reference, {
        ...renamed,
        "lib/config-validator.js": "module.exports = { stub: true }\n",
      }),
    ).toEqual(["eslint.config.js"]);
  });

  it("never reads a configuration the tool finds by name as transported once it is moved", async () => {
    const reference = {
      "package.json": manifest({ test: "mocha" }),
      ".mocharc.json": '{ "spec": "test/**/*.js", "forbidOnly": true }\n',
      "test/a.js": "t",
    };
    const moved = {
      "package.json": manifest({ test: "mocha" }),
      "config/mocharc.json": reference[".mocharc.json"],
      "test/a.js": "t",
    };
    expect(await changes({ command: "npm test", argv: null }, reference, moved)).toEqual([
      ".mocharc.json",
    ]);
  });

  it("is refused offline where a recorded move names no recorded rename", async () => {
    const observation = await observeInstrument(npm("lint"), trees(reference, renamed));
    const forged = JSON.parse(JSON.stringify(observation));
    const entry = forged.files.find((file: { path: string }) => file.path === "eslint.config.js");
    entry.moves = [{ was: "'no-undef': 'error'", now: "'no-undef': 'off'" }];
    expect(offlineChanges(forged)).toEqual(["eslint.config.js"]);
    delete entry.moves;
    expect(offlineChanges(forged)).toEqual(["eslint.config.js"]);
  });

  it("is refused offline when a record claims a transport it does not carry", async () => {
    const observation = await observeInstrument(npm("lint"), trees(reference, renamed));
    const { transport: _transport, ...stripped } = JSON.parse(JSON.stringify(observation));
    expect(offlineChanges(stripped)).toEqual(["eslint.config.js"]);
    const forged = JSON.parse(JSON.stringify(observation));
    forged.files.push({
      path: "vitest.config.js",
      reference: forged.files[0].reference,
      current: null,
      transported: true,
    });
    expect(offlineChanges(forged)).toEqual(["vitest.config.js"]);
  });
});
