/**
 * Live probes for the argv-spawn / scrubbed-env boundary. Not a test file.
 * Run with: node redteam/pass7/probe-all.mjs
 */
import { execFile, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const {
  harnessControlledEnvironment,
  harnessControlledNodeTest,
  processIsolation,
} = await import(join(root, "src/gates/node-test-command.ts"));
const { coverageReportingCommand } = await import(join(root, "src/gates/coverage-artifact.ts"));
const { createNodeCommandRunner } = await import(join(root, "src/gates/node-command-runner.ts"));
const { parseLineHits, fileLineHits, parseTapOutcomes } = await import(
  join(root, "src/gates/parsers.ts")
);
const { takeMeasureSnapshot } = await import(join(root, "src/gates/measure-snapshot.ts"));
const { assessRespecification } = await import(join(root, "src/gates/respecification.ts"));
const { controlOutcomePath } = await import(join(root, "src/gates/base-control.ts"));
const { asLatinLetters } = await import(join(root, "src/evidence/latin-lookalikes.ts"));
const { scrubJson, findKnownSecrets, findBlockingSecrets } = await import(
  join(root, "src/evidence/scrub.ts")
);
const { measureTestFile } = await import(join(root, "src/gates/measures.ts"));
const { createTestClock } = await import(join(root, "src/core/test-doubles.ts"));

function emit(row) {
  console.log(JSON.stringify(row));
}

const coverageHarness = [
  "--experimental-test-coverage",
  processIsolation,
  "--test-reporter=tap",
  "--test-reporter-destination=stdout",
  "--test-reporter=lcov",
  "--test-reporter-destination=/session/tests.lcov",
];

const controlHarness = [
  "--test-reporter=tap",
  "--test-reporter-destination=stdout",
  "--test-reporter=tap",
  "--test-reporter-destination=/session/control.tap",
  processIsolation,
];

// ---------------------------------------------------------------------------
// Part A: argv construction
// ---------------------------------------------------------------------------

const splitBodies = [
  "node --test --test-concurrency 2",
  "node --test --test-concurrency --test-timeout",
  "node --test --test-name-pattern --disable-warning",
  "node --test --test-concurrency --test-timeout --test-name-pattern --test-skip-pattern --test-shard",
  "node --test --disable-warning --test-timeout",
  "node --test --test-timeout --test-concurrency",
  "node --test --test-name-pattern foo",
  "node --test --test-name-pattern='foo bar'",
  "node --test '--test-name-pattern=foo bar'",
  "node --test --test=src/**/*.test.mjs",
  "node --test --test-only=true",
  "node --test '--test-concurrency'",
  "node --test '--test-timeout'",
  "node --test '--experimental-strip-types'",
  "node --test '--test-force-exit'",
  "node --test --test-shard 1/2",
  "node --test -- --require=./hook.cjs",
  "node --test './--require=./hook.cjs'",
  "node --test --experimental-strip-types=./hook.mjs",
  "node --test --test-concurrency=--require=./hook.cjs",
];

for (const body of splitBodies) {
  const coverage = coverageReportingCommand(body, "/session/tests.lcov");
  const control = harnessControlledNodeTest(body, controlHarness, ["one.test.mjs"]);
  emit({
    id: "A-argv-build",
    body,
    coverage,
    control,
    coverageVouched: coverage !== null,
    controlVouched: control !== null,
  });
}

// Fresh quoted-flag framings (not the pass-6 single-quoted isolation/require/env-file)
const quotedFramings = [
  'node --test "--test-isolation" "none"',
  "node --test '--test-isolation' 'none'",
  "node --test '--test_isolation=none'",
  "node --test '--test-isolation＝none'",
  "node --test $'--test-isolation=none'",
  "node --test '--require' './hook.cjs'",
  "node --test '--import' './hook.mjs'",
  "node --test '--env-file' '.env'",
  "node --test '--experimental-loader' './hook.mjs'",
  "node --test '--conditions' 'development'",
  "node --test ' --require=./hook.cjs'",
  "node --test '--require=./hook.cjs '",
  "node --test --test-name-pattern '--require=./hook.cjs'",
];

for (const body of quotedFramings) {
  emit({
    id: "A-quoted-second-framing",
    body,
    vouched: harnessControlledNodeTest(body, coverageHarness) !== null,
    argv: harnessControlledNodeTest(body, coverageHarness),
  });
}

// Does node consume the next argv element as a flag value even when it starts with -?
{
  const dir = await mkdtemp(join(tmpdir(), "pass7-consume-"));
  try {
    await writeFile(
      join(dir, "see.test.mjs"),
      [
        'import { test } from "node:test";',
        "test('see', () => {",
        "  console.log('EXEC=' + JSON.stringify(process.execArgv));",
        "  console.log('ARGV=' + JSON.stringify(process.argv));",
        "  console.log('PID=' + process.pid);",
        "  console.log('PPID=' + process.ppid);",
        "});",
        "",
      ].join("\n"),
    );

    const vectors = [
      ["node", "--test", "--test-concurrency", "--test-isolation=process", "see.test.mjs"],
      ["node", "--test", "--test-timeout", "--test-isolation=process", "see.test.mjs"],
      ["node", "--test", "--disable-warning", "--test-isolation=process", "see.test.mjs"],
      ["node", "--test", "--test-name-pattern", "--test-isolation=process", "see.test.mjs"],
      [
        "node",
        "--test",
        "--test-concurrency",
        "--test-timeout",
        "--experimental-test-coverage",
        "--test-isolation=process",
        "see.test.mjs",
      ],
      [
        "node",
        "--test",
        "--test-concurrency",
        "--test-timeout",
        "--test-name-pattern",
        "--test-skip-pattern",
        "--test-shard",
        "--test-reporter=tap",
        "--test-reporter-destination=stdout",
        "--test-reporter=tap",
        "--test-reporter-destination=/tmp/x.tap",
        "--test-isolation=process",
        "see.test.mjs",
      ],
    ];

    for (const argv of vectors) {
      const ran = spawnSync(argv[0], argv.slice(1), {
        cwd: dir,
        encoding: "utf8",
        timeout: 20_000,
      });
      emit({
        id: "A-node-consumes-next",
        argv,
        status: ran.status,
        stdout: ran.stdout.slice(0, 1500),
        stderr: ran.stderr.slice(0, 800),
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// A test file path node might treat specially
{
  const dir = await mkdtemp(join(tmpdir(), "pass7-special-"));
  try {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "scratch", type: "module" }));
    await mkdir(join(dir, "node_modules"), { recursive: true });

    // data: URL as the "pattern"
    const dataBody = "node --test data:text/javascript,console.log('DATA_RAN='+process.pid)";
    emit({
      id: "A-data-url-vouch",
      body: dataBody,
      argv: harnessControlledNodeTest(dataBody, coverageHarness),
    });

    // package.json as the file
    emit({
      id: "A-package-json-pattern",
      argv: harnessControlledNodeTest("node --test package.json", coverageHarness),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Part B: scrubbed environment
// ---------------------------------------------------------------------------

const envProbe = harnessControlledEnvironment({
  PATH: "/usr/bin:/bin",
  HOME: "/home/dev",
  NODE_ENV: "test",
  NODE_OPTIONS: "--require=./hook.cjs",
  node_options: "--require=./hook.cjs",
  NODE_PATH: "/tmp/modules",
  OPENSSL_CONF: "/tmp/openssl.cnf",
  OPENSSL_MODULES: "/tmp/ossl-modules",
  OPENSSL_ENGINES: "/tmp/ossl-engines",
  SSL_CERT_FILE: "/tmp/cert.pem",
  SSL_CERT_DIR: "/tmp/certs",
  LD_PRELOAD: "/tmp/hook.so",
  LD_LIBRARY_PATH: "/tmp/libs",
  LD_AUDIT: "/tmp/audit.so",
  DYLD_INSERT_LIBRARIES: "/tmp/hook.dylib",
  DYLD_LIBRARY_PATH: "/tmp/libs",
  DYLD_FRAMEWORK_PATH: "/tmp/fw",
  DYLD_FALLBACK_LIBRARY_PATH: "/tmp/fallback-libs",
  DYLD_FALLBACK_FRAMEWORK_PATH: "/tmp/fallback-fw",
  DYLD_VERSIONED_LIBRARY_PATH: "/tmp/ver-libs",
  DYLD_IMAGE_SUFFIX: "_evil",
  DYLD_ROOT_PATH: "/tmp/root",
  npm_config_node_options: "--require=./hook.cjs",
  npm_config_userconfig: "/tmp/.npmrc",
  FORCE_COLOR: "1",
  NO_COLOR: "1",
  CI: "true",
  TZ: "UTC",
  UV_THREADPOOL_SIZE: "1",
  NODE_COMPILE_CACHE: "/tmp/cc",
  NODE_REPL_EXTERNAL_MODULE: "./hook.mjs",
  WATCH_REPORT_DEPENDENCIES: "1",
  DOTENV_CONFIG_PATH: "./.env",
  DOTENV_CONFIG_OVERRIDE: "true",
});

emit({
  id: "B-env-survivors",
  kept: Object.keys(envProbe).sort(),
  droppedNodeEnv: !("NODE_ENV" in envProbe),
  keptOpensslConf: "OPENSSL_CONF" in envProbe,
  keptOpensslModules: "OPENSSL_MODULES" in envProbe,
  keptOpensslEngines: "OPENSSL_ENGINES" in envProbe,
  keptDyldFallback: "DYLD_FALLBACK_LIBRARY_PATH" in envProbe,
  keptNpmConfigNodeOptions: "npm_config_node_options" in envProbe,
  keptPath: envProbe.PATH,
});

// Does node actually read OPENSSL_CONF at startup?
{
  const dir = await mkdtemp(join(tmpdir(), "pass7-openssl-"));
  try {
    const conf = join(dir, "evil.cnf");
    await writeFile(
      conf,
      [
        "openssl_conf = openssl_init",
        "[openssl_init]",
        "providers = provider_sect",
        "[provider_sect]",
        "default = default_sect",
        "bogus = bogus_sect",
        "[default_sect]",
        "activate = 1",
        "[bogus_sect]",
        "module = /no/such/provider.so",
        "activate = 1",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(dir, "see.test.mjs"),
      "import { test } from 'node:test';\ntest('t', () => { console.log('OPENSSL_RAN'); });\n",
    );

    const withConf = spawnSync("node", ["--test", "see.test.mjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, OPENSSL_CONF: conf },
    });
    const without = spawnSync("node", ["--test", "see.test.mjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, OPENSSL_CONF: undefined },
    });
    emit({
      id: "B-openssl-conf-live",
      withStatus: withConf.status,
      withStdout: withConf.stdout.slice(0, 400),
      withStderr: withConf.stderr.slice(0, 800),
      withoutStatus: without.status,
      withoutStdout: without.stdout.slice(0, 200),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// PATH hijack: relative node_modules/.bin/node
{
  const dir = await mkdtemp(join(tmpdir(), "pass7-path-"));
  try {
    await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
    const wrapper = join(dir, "node_modules", ".bin", "node");
    await writeFile(
      wrapper,
      [
        "#!/bin/sh",
        "echo WRAPPER_RAN",
        "echo WRAPPER_ARGS=\"$*\"",
        "for arg in \"$@\"; do",
        '  case "$arg" in',
        "    --test-reporter-destination=*.lcov)",
        '      dest="${arg#--test-reporter-destination=}"',
        "      printf 'SF:clamp.mjs\\nDA:1,1\\nDA:2,1\\nDA:3,1\\nDA:4,1\\nDA:5,1\\nDA:6,1\\nDA:7,1\\nDA:8,1\\nDA:9,1\\nLF:9\\nLH:9\\nend_of_record\\n' > \"$dest\"",
        "      ;;",
        "  esac",
        "done",
        "exit 0",
        "",
      ].join("\n"),
    );
    await chmod(wrapper, 0o755);
    await writeFile(
      join(dir, "see.test.mjs"),
      "import { test } from 'node:test';\ntest('t', () => {});\n",
    );

    const hijackEnv = harnessControlledEnvironment({
      PATH: `node_modules/.bin:${process.env.PATH ?? "/usr/bin"}`,
      HOME: process.env.HOME,
    });

    const ran = spawnSync("node", ["--test", "see.test.mjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15_000,
      env: hijackEnv,
    });
    emit({
      id: "B-path-relative-spawn",
      status: ran.status,
      stdout: ran.stdout.slice(0, 500),
      stderr: ran.stderr.slice(0, 400),
      wrapperInPath: hijackEnv.PATH.startsWith("node_modules/.bin"),
    });

    // Same via the harness runner
    const dest = join(dir, "forged.lcov");
    const runner = createNodeCommandRunner(createTestClock(1));
    const previousPath = process.env.PATH;
    process.env.PATH = `node_modules/.bin:${previousPath ?? "/usr/bin"}`;
    try {
      const argv = coverageReportingCommand("node --test", dest);
      const observation = argv === null ? null : await runner.runVouched(argv, { cwd: dir, timeoutMs: 15_000 });
      let written = null;
      try {
        written = await readFile(dest, "utf8");
      } catch {
        written = null;
      }
      emit({
        id: "B-path-hijack-runner",
        argv,
        exitCode: observation?.exitCode ?? null,
        stdout: observation?.stdout?.slice(0, 400) ?? null,
        stderr: observation?.stderr?.slice(0, 400) ?? null,
        written,
        forged: written?.includes("LH:9") ?? false,
      });
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// NODE_ENV: dropped, and a suite that depends on it
{
  const dir = await mkdtemp(join(tmpdir(), "pass7-nodeenv-"));
  try {
    await writeFile(
      join(dir, "env.test.mjs"),
      [
        'import { test } from "node:test";',
        'import assert from "node:assert/strict";',
        "test('needs NODE_ENV=test', () => {",
        "  console.log('SAW_NODE_ENV=' + JSON.stringify(process.env.NODE_ENV));",
        "  assert.equal(process.env.NODE_ENV, 'test');",
        "});",
        "",
      ].join("\n"),
    );
    const env = harnessControlledEnvironment({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
    });
    const ran = spawnSync("node", ["--test", "env.test.mjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15_000,
      env,
    });
    emit({
      id: "B-node-env-dropped-live",
      keptKeys: Object.keys(env).sort(),
      status: ran.status,
      stdout: ran.stdout.slice(0, 600),
      stderr: ran.stderr.slice(0, 400),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// npm_config_node_options: does node itself honor it?
{
  const dir = await mkdtemp(join(tmpdir(), "pass7-npmcfg-"));
  try {
    await writeFile(join(dir, "hook.cjs"), "console.log('NPM_CFG_HOOK');\n");
    await writeFile(
      join(dir, "see.test.mjs"),
      "import { test } from 'node:test';\ntest('t', () => { console.log('TEST_OK'); });\n",
    );
    const ran = spawnSync("node", ["--test", "see.test.mjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...harnessControlledEnvironment({
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          npm_config_node_options: "--require=./hook.cjs",
        }),
      },
    });
    emit({
      id: "B-npm-config-node-options",
      status: ran.status,
      stdout: ran.stdout.slice(0, 400),
      hookLoaded: ran.stdout.includes("NPM_CFG_HOOK"),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Part C: lap-2 winners, second framing
// ---------------------------------------------------------------------------

// C1 quoted isolation/require/env-file as patterns — already above. Confirm abstention.
for (const body of [
  "node --test '--test-isolation=none'",
  "node --test '--require=./hook.cjs'",
  "node --test '--env-file=.env'",
]) {
  emit({
    id: "C-quoted-must-abstain",
    body,
    argv: harnessControlledNodeTest(body, coverageHarness),
  });
}

// C2 inherited NODE_OPTIONS must measure honestly
{
  const dir = await mkdtemp(join(tmpdir(), "pass7-nodeopt-"));
  try {
    await writeFile(join(dir, "clamp.mjs"), "export function clamp(v,l,h){return v;}\n");
    await writeFile(
      join(dir, "hook.cjs"),
      "console.log('SHOULD_NOT_LOAD');\n",
    );
    await writeFile(
      join(dir, "clamp.test.mjs"),
      [
        'import { test } from "node:test";',
        'import assert from "node:assert/strict";',
        'import { clamp } from "./clamp.mjs";',
        'test("inside", () => { assert.equal(clamp(5,0,10), 5); });',
        "",
      ].join("\n"),
    );
    const env = harnessControlledEnvironment({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_OPTIONS: "--require=./hook.cjs",
    });
    const ran = spawnSync("node", ["--test", "clamp.test.mjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15_000,
      env,
    });
    emit({
      id: "C-node-options-scrubbed",
      hookLoaded: ran.stdout.includes("SHOULD_NOT_LOAD") || ran.stderr.includes("SHOULD_NOT_LOAD"),
      status: ran.status,
      stdout: ran.stdout.slice(0, 300),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// C3 two-section lcov, second framing: same file via ./ vs bare vs file:// vs trailing slash
{
  const added = Array.from({ length: 9 }, (_i, i) => ({ line: i + 1, text: "x" }));
  const reports = [
    [
      "SF:clamp.mjs",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
      "SF:./clamp.mjs",
      "DA:2,1",
      "DA:3,1",
      "DA:4,1",
      "DA:5,1",
      "DA:6,1",
      "DA:7,1",
      "DA:8,1",
      "DA:9,1",
      "LF:8",
      "LH:8",
      "end_of_record",
    ].join("\n"),
    [
      "SF:/tmp/ws/clamp.mjs",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
      "SF:clamp.mjs",
      "DA:2,1",
      "DA:3,1",
      "DA:4,1",
      "DA:5,1",
      "DA:6,1",
      "DA:7,1",
      "DA:8,1",
      "DA:9,1",
      "LF:8",
      "LH:8",
      "end_of_record",
    ].join("\n"),
    [
      "SF:clamp.mjs",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
      "SF:clamp.mjs",
      "DA:1,1",
      "DA:2,1",
      "DA:3,1",
      "DA:4,1",
      "DA:5,1",
      "DA:6,1",
      "DA:7,1",
      "DA:8,1",
      "DA:9,1",
      "LF:9",
      "LH:9",
      "end_of_record",
    ].join("\n"),
  ];
  for (const [index, report] of reports.entries()) {
    const snap = await takeMeasureSnapshot({
      changes: {
        files: [{ path: "clamp.mjs", kind: "modified", addedLines: added, removedLines: [] }],
      },
      probe: { readCurrent: async () => "", readBase: async () => "" },
      workspaceRoot: "/tmp/ws",
      trackedTestFiles: [],
      gateMeasures: {},
      coverageReports: [report],
    });
    emit({
      id: "C-two-section-second",
      index,
      covered: snap.changedLinesCovered,
      measured: snap.changedLinesMeasured,
      ratio: snap.changedLineCoverage,
    });
  }
}

// C4 skipped-name attribution, second framing: # TODO, yaml skip, SKIP without spaces
{
  const docs = [
    ["todo-directive", ["TAP version 13", "1..2", "ok 1 - innocentNew # TODO", "ok 2 - attacker", "    not ok 1 - innocentNew", ""].join("\n")],
    ["skip-nospace", ["TAP version 13", "1..2", "ok 1 - innocentNew #SKIP", "ok 2 - attacker", "    not ok 1 - innocentNew", ""].join("\n")],
    ["skip-lowercase", ["TAP version 13", "1..2", "ok 1 - innocentNew # skip", "ok 2 - attacker", "    not ok 1 - innocentNew", ""].join("\n")],
    ["todo-and-fail", ["TAP version 13", "1..1", "not ok 1 - innocentNew # TODO", ""].join("\n")],
    ["skipped-word-in-name", ["TAP version 13", "1..2", "ok 1 - innocentNew SKIPPED", "    not ok 1 - innocentNew", "ok 2 - attacker", ""].join("\n")],
  ];
  for (const [label, text] of docs) {
    emit({
      id: "C-skip-second",
      label,
      outcomes: parseTapOutcomes(text),
    });
  }
}

// C5 missing-binding fifth syntax
{
  const fifths = [
    ["in-operator", "TypeError: Cannot use 'in' operator to search for 'mul' in undefined"],
    ["instanceof", "TypeError: Right-hand side of 'instanceof' is not an object"],
    ["convert-to-object", "TypeError: Cannot convert undefined or null to object"],
    ["object-create", "TypeError: Object prototype may only be an Object or null: undefined"],
    ["not-an-object", "TypeError: mul is not an object"],
    ["cannot-assign", "TypeError: Cannot assign to read only property 'mul' of undefined"],
    ["define-property", "TypeError: Cannot define property mul, object is not extensible"],
    ["set-prototype", "TypeError: Object.setPrototypeOf called on null or undefined"],
    ["reflect-get", "TypeError: Reflect.get called on non-object"],
    ["class-extends", "TypeError: Class extends value undefined is not a constructor or null"],
    ["cannot-read-priv", "TypeError: Cannot read private member #mul from an object whose class did not declare it"],
  ];
  for (const [label, detail] of fifths) {
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: () =>
          Promise.resolve({
            outcome: "failed",
            detail: ["✖ multiplies (0.7ms)", `  ${detail}`, "not ok 1 - multiplies"].join("\n"),
            exitCode: 1,
            failedTests: ["multiplies"],
          }),
        runOnSubmittedSource: () =>
          Promise.resolve({
            outcome: "passed",
            detail: "exited 0",
            exitCode: 0,
            failedTests: [],
          }),
      },
      { newTests: ["multiplies"] },
    );
    emit({
      id: "C-fifth-syntax",
      label,
      detail,
      exempt: finding.exempt,
      newSpecs: finding.newSpecifications,
      reason: finding.reason.slice(0, 160),
    });
  }
}

// Live fifth syntax: `in` operator against a missing CJS export
{
  const dir = await mkdtemp(join(tmpdir(), "pass7-inop-"));
  try {
    await writeFile(join(dir, "math.cjs"), "module.exports = { add: (a, b) => a + b };\n");
    await writeFile(
      join(dir, "math.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const math = require("./math.cjs");',
        'test("multiplies", () => {',
        "  assert.equal('mul' in math ? math.mul(2, 3) : ('mul' in math.mul), true);",
        "});",
        "",
      ].join("\n"),
    );
    // Wait, if math.mul is undefined, `'mul' in math` is false (math exists).
    // Need to bind the missing export: const { mul } = require(...)
    await writeFile(
      join(dir, "math.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const { mul } = require("./math.cjs");',
        'test("multiplies", () => {',
        "  assert.equal('x' in mul, false);",
        "});",
        "",
      ].join("\n"),
    );
    const ran = spawnSync("node", ["--test", "math.test.cjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15_000,
    });
    emit({
      id: "C-fifth-in-live",
      status: ran.status,
      stdout: ran.stdout.slice(0, 800),
      stderr: ran.stderr.slice(0, 400),
    });

    await writeFile(
      join(dir, "keys.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const { mul } = require("./math.cjs");',
        'test("multiplies", () => {',
        "  assert.deepEqual(Object.keys(mul), ['name']);",
        "});",
        "",
      ].join("\n"),
    );
    const keys = spawnSync("node", ["--test", "keys.test.cjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15_000,
    });
    emit({
      id: "C-fifth-keys-live",
      status: keys.status,
      stdout: keys.stdout.slice(0, 800),
      stderr: keys.stderr.slice(0, 400),
    });

    await writeFile(
      join(dir, "inst.test.cjs"),
      [
        'const { test } = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const { mul } = require("./math.cjs");',
        'test("multiplies", () => {',
        "  assert.equal(0 instanceof mul, false);",
        "});",
        "",
      ].join("\n"),
    );
    const inst = spawnSync("node", ["--test", "inst.test.cjs"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15_000,
    });
    emit({
      id: "C-fifth-instanceof-live",
      status: inst.status,
      stdout: inst.stdout.slice(0, 800),
      stderr: inst.stderr.slice(0, 400),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Part D: claims, scrub, digest, residuals
// ---------------------------------------------------------------------------

emit({
  id: "D-digest-collision-paths",
  a: controlOutcomePath("/s", "foo/bar.test.ts"),
  b: controlOutcomePath("/s", "foo-bar.test.ts"),
  c: controlOutcomePath("/s", "foo.bar.test.ts"),
  d: controlOutcomePath("/s", "foo\\bar.test.ts"),
  sameAB: controlOutcomePath("/s", "foo/bar.test.ts") === controlOutcomePath("/s", "foo-bar.test.ts"),
});

// C4/C7 still closed: Cyrillic lookalike name, array of objects
{
  const cyrillic = { pаssword: "sk-live-abc" }; // Cyrillic а
  const folded = asLatinLetters("pаssword");
  const objects = { pin: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }] };
  const primitives = { pin: [1, 2, 3, 4, 5, 6] };
  emit({
    id: "D-scrub-c4-c7",
    foldedName: folded,
    cyrillicScrub: scrubJson(cyrillic),
    cyrillicFindings: findKnownSecrets(JSON.stringify(cyrillic)),
    objectsScrub: scrubJson(objects),
    objectsFindings: findKnownSecrets(JSON.stringify(objects)),
    primitivesScrub: scrubJson(primitives),
    primitivesFindings: findKnownSecrets(JSON.stringify(primitives)),
    objectsBlocked: findBlockingSecrets(JSON.stringify(objects)).length > 0,
    primitivesBlocked: findBlockingSecrets(JSON.stringify(primitives)).length > 0,
  });
}

// Residuals + legitimate controls
{
  const selfCompare = measureTestFile("test('a', () => { expect(obj.a).toBe(obj.a); });");
  const literalCompare = measureTestFile("test('a', () => { expect(true).toBe(true); });");
  const realCompare = measureTestFile("test('a', () => { expect(value).toBe(1); });");
  const realReturn = measureTestFile("test('a', () => { expect(add(2, 3)).toBe(5); });");
  emit({
    id: "D-residual-assertions",
    selfCompare,
    literalCompare,
    realCompare,
    realReturn,
  });
}

emit({ done: true });
