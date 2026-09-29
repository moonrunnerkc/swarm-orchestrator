import { describe, expect, it } from "vitest";
import { instrumentChanges as offlineChanges, readStatus } from "../evidence/verifier/status.mjs";
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

const npm = (script: string) => ({ command: `npm run --silent ${script}`, argv: null });
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
