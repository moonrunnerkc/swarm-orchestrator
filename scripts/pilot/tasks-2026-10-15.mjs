/**
 * The 2026-10-15 comparison's frozen task set: four maintainer-authored changes from three
 * public repositories that no earlier launch, calibration, diagnosis or repair in this repository
 * used, plus one calibration task both tools must deliver before the comparison is frozen. The
 * pako repository carries two tasks (a feature and a refactor, different commits); the csstree
 * repository's one task here is a change its earlier task (the generator's raw-value
 * whitespace) did not touch. Each task's base is the parent
 * of the upstream commit; the hidden oracle is the upstream commit's own test files overlaid from
 * the sealed mirror at scoring time, plus the structural, version and extra checks named here;
 * the visible check is one weaker assertion both arms are shown. Task text was written from the
 * change without naming it.
 *
 * Selection criteria, declared before either arm attempted any of them, are in
 * docs/evidence/2026-10-15/comparison/candidates.md with the candidates excluded and why.
 *
 * Stage B repeats the bug fix and the feature unchanged under ids with the suffix "-rep".
 * `wrongPatches` holds one deliberately wrong or partial implementation per task, used only by
 * the validator to show the hidden oracle rejects a relevant mistake; the bug fix's wrong patch
 * is the security negative control (a fix that strips the two ASCII line terminators and leaves
 * the Unicode ones).
 */

export const tasks = [
  {
    id: "mime-bugfix-gettype-line-terminators",
    repository: "broofa/mime",
    workType: "bugfix",
    baseCommit: "953ae3ebc59c387064f3760b73085eff6760a7f6",
    upstreamCommit: "d7871f3bac120df5e4776e7c395b39d0d8e7b562",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [["npm", "run", "build"]],
    projectTest: ["npm", "test"],
    visiblePrefix: "npm run build && ",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "npm run build && node acceptance/visible/check.mjs",
      source:
        "import assert from 'node:assert/strict';\nimport mime from '../../dist/src/index.js';\n\n// A file name holding a line feed must still be typed by the extension after its last dot.\nassert.equal(mime.getType('LINE\\nFEED.png'), 'image/png');\nassert.equal(mime.getType('/path/to/LINE\\nFEED.png'), 'image/png');\n\n// Ordinary names are unchanged.\nassert.equal(mime.getType('report.html'), 'text/html');\nassert.equal(mime.getType('/path/to/.config.json'), 'application/json');\nassert.equal(mime.getType('/path/to/file'), null);\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: ["test/mime.test.js"],
      argv: ["node", "--test", "test/mime.test.js"],
      allowedPaths: ["src/Mime.ts"],
    },
    immutable: ["test", "types"],
    taskText:
      "Mime.getType(path) (src/Mime.ts) derives a type from the extension after the last dot of the last path segment. The two regular expressions that strip the directory part and the part before the extension do not match across line terminators, so a file name that contains one is typed wrongly: getType('LINE\\nFEED.png') returns null instead of 'image/png', and the same happens for a carriage return (U+000D), a line separator (U+2028) and a paragraph separator (U+2029), with or without a directory part in front. This matters where the file name comes from an untrusted source: a content type decided from it must come from the extension after the last dot of the last segment, whatever characters precede it, so that a name crafted with a line terminator cannot make the lookup fail or pick an earlier extension. Make getType treat every line terminator like any other character when it strips the directory part and the extension's prefix; a space or tab in the name already works and must keep working. getExtension, define and the rest of the class stay as they are. The change belongs in src/Mime.ts only. Repository rules: keep the file's existing style, no new dependencies, no edits under test or types, and the whole suite (npm test, which builds first) must keep passing.",
  },
  {
    id: "pako-feature-inflate-push-after-end",
    repository: "nodeca/pako",
    workType: "feature",
    baseCommit: "ef2f14af9b51376aa82215e68a3747a0faac62b7",
    upstreamCommit: "16fb5c47d936af5c88e943178c8e6f455e067128",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        "import assert from 'node:assert/strict';\nimport zlib from 'node:zlib';\nimport { Inflate } from '../../src/index.ts';\n\n// A compressed stream can end before the caller's data does: trailing chunks are no-ops that\n// report the decode's outcome and leave the delivered result intact.\nconst stream = zlib.deflateSync(Buffer.from('payload'));\nconst inflator = new Inflate();\nassert.equal(inflator.push(stream), true);\nassert.equal(inflator.ended, true);\nassert.equal(inflator.push(new Uint8Array([1, 2, 3])), true);\nassert.equal(Buffer.from(inflator.result).toString(), 'payload');\nassert.equal(inflator.err, 0);\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: ["test/inflate.test.mjs"],
      argv: ["node", "--test", "test/inflate.test.mjs"],
      allowedPaths: ["src/inflate.ts", "CHANGELOG.md"],
    },
    immutable: ["test", "benchmark"],
    taskText:
      "The streaming decoder class Inflate (src/inflate.ts) tracks whether the compressed stream has ended in a private `ended` field, and its push(data, flush_mode) method returns a blanket false for every call made after that point. A compressed stream can end before the caller's data does (trailing bytes after the deflate or gzip stream), and the caller has no way to know that in advance, so a push made after the end must become a no-op that reports the recorded outcome instead: once the stream has ended, push returns true if the decode finished without error (this.err is Z_OK) and false if it failed, whatever data or flush mode it is given, and it leaves `err`, `msg` and `result` exactly as they were, so the delivered result survives any trailing chunks and a failed stream keeps reporting failure. Make `ended` a public, documented property so callers can check it, and document the new push behaviour in its JSDoc. Pushes before the end, the onData and onEnd callbacks, the one-shot inflate helpers and everything else are unchanged. The project's full check (npm test: lint, build, type-check and the node test suite) must keep passing; change only src/inflate.ts (a CHANGELOG entry is welcome but not required) and do not edit tests or benchmarks.",
  },
  {
    id: "pako-refactor-options-default-param",
    repository: "nodeca/pako",
    workType: "refactor",
    baseCommit: "b77b601e1a86512887c83839a92f4ce8ab50266f",
    upstreamCommit: "1754a8b32c876f155aa816d33681db4553838123",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        "import { readFileSync } from 'node:fs';\nimport assert from 'node:assert/strict';\nimport { Deflate, Inflate, deflate, inflate } from '../../src/index.ts';\n\nconst inflateSource = readFileSync(new URL('../../src/inflate.ts', import.meta.url), 'utf8');\nconst deflateSource = readFileSync(new URL('../../src/deflate.ts', import.meta.url), 'utf8');\n\n// The fallbacks are gone from both files.\nassert.equal((inflateSource.match(/options \\|\\| \\{\\}/g) ?? []).length, 0, 'inflate.ts still has `options || {}`');\nassert.equal((deflateSource.match(/options \\|\\| \\{\\}/g) ?? []).length, 0, 'deflate.ts still has `options || {}`');\n\n// Behaviour is unchanged with and without options.\nconst data = new TextEncoder().encode('pako default options');\nassert.equal(new TextDecoder().decode(inflate(deflate(data))), 'pako default options');\nassert.equal(inflate(deflate(data), { toText: true }), 'pako default options');\nconst d = new Deflate();\nd.push(data, true);\nconst i = new Inflate();\ni.push(d.result, true);\nassert.equal(new TextDecoder().decode(i.result), 'pako default options');\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: [],
      argv: ["npm", "test"],
      structural: [
        { pattern: "options \\|\\| \\{\\}", files: ["src/inflate.ts", "src/deflate.ts"], count: 0 },
        { pattern: "options \\?\\? \\{\\}", files: ["src/inflate.ts", "src/deflate.ts"], count: 0 },
        { pattern: "options\\?: InflateOptions\\b", files: ["src/inflate.ts"], count: 0 },
        { pattern: "options\\?: DeflateOptions\\b", files: ["src/deflate.ts"], count: 0 },
        { pattern: "options: InflateOptions = \\{\\}", files: ["src/inflate.ts"], count: 1 },
        { pattern: "options: DeflateOptions = \\{\\}", files: ["src/deflate.ts"], count: 4 },
        { pattern: "options: O = \\{\\} as O", files: ["src/inflate.ts"], count: 3 },
        { pattern: "options\\?: O\\b", files: ["src/inflate.ts"], count: 0 },
      ],
      allowedPaths: ["src/inflate.ts", "src/deflate.ts"],
    },
    immutable: ["test", "benchmark"],
    taskText:
      "In src/inflate.ts and src/deflate.ts the `options` parameter is declared optional (`options?: InflateOptions`, `options?: DeflateOptions`, and `options?: O` on the inflate, inflateRaw and ungzip helpers) and every use guards against its absence with `options || {}`, `options ?? {}` or an `options && options.windowBits` test. Refactor both files so the parameter carries a default value instead and the guards go: the two class constructors declare `options: InflateOptions = {}` and `options: DeflateOptions = {}` and pass `options` straight to Object.assign; the three helper functions in inflate.ts declare `options: O = {} as O` (their generic parameter `O` loses its `= {}` default, since the value now has one) and pass `options` straight through, reading `options.toText` and `options.windowBits` directly with no intermediate `opts` variable and no truthiness guard on `options` itself. Structural requirements, each checked by regular expression after the change: `options || {}` and `options ?? {}` occur zero times across the two files; `options?: InflateOptions`, `options?: DeflateOptions` and `options?: O` occur zero times; `options: InflateOptions = {}` occurs exactly once in src/inflate.ts, `options: DeflateOptions = {}` exactly four times in src/deflate.ts (the constructor and the three helpers that already carry it), and `options: O = {} as O` exactly three times in src/inflate.ts. Behaviour must be unchanged for every caller, with and without options, and the project's full check (npm test: lint, build, type-check and the node test suite) must pass as it does today. Change nothing outside these two files; do not edit tests, benchmarks or the build.",
  },
  {
    id: "csstree-upgrade-esbuild-0-24",
    repository: "csstree/csstree",
    workType: "upgrade",
    baseCommit: "eab1c8e7819786d0ec53a744271c3b90fb0b5659",
    upstreamCommit: "7cfec03270088f42ee40db1c744e00efe2bc219e",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        "import { readFileSync } from 'node:fs';\nimport assert from 'node:assert/strict';\n\nconst pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));\nassert.equal(pkg.devDependencies.esbuild, '0.24.0', pkg.devDependencies.esbuild);\nconst lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));\nassert.equal(lock.packages['node_modules/esbuild'].version, '0.24.0');\nassert.equal(lock.packages[''].devDependencies.esbuild, '0.24.0');\nconst installed = JSON.parse(readFileSync(new URL('../../node_modules/esbuild/package.json', import.meta.url), 'utf8'));\nassert.equal(installed.version, '0.24.0');\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: [],
      argv: ["npm", "run", "build-and-test"],
      upgrade: [
        { name: "esbuild", section: "devDependencies", version: "0.24.0", declared: "0.24.0" },
      ],
      unchanged: [
        "scripts.build",
        "scripts.bundle",
        "scripts.esm-to-cjs",
        "scripts.test",
        "dependencies",
      ],
      allowedPaths: ["package.json", "package-lock.json"],
    },
    upgradeSourcePaths: [],
    immutable: ["lib", "scripts", "fixtures"],
    taskText:
      'Upgrade the esbuild bundler this project builds its dist files with. In package.json the devDependency "esbuild" is currently "^0.14.53"; change it to exactly "0.24.0" (declare "0.24.0", no range) and regenerate package-lock.json with npm so that the lockfile resolves esbuild to 0.24.0, its root package entry records the same declaration, and npm ci installs 0.24.0. The build (npm run build, which runs the bundle script in scripts/bundle.js through esbuild and then the esm-to-cjs step) and the bundled and CommonJS test suites (npm run build-and-test) must pass after the upgrade. Do not change any other dependency, the scripts block, or anything under lib, scripts or fixtures; the change is package.json and package-lock.json only.',
  },
];

/** The calibration task: one real change both tools must deliver before the comparison is frozen. */
export const calibrationTasks = [
  {
    id: "argparse-calibration-number-conversion",
    repository: "nodeca/argparse",
    workType: "bugfix",
    baseCommit: "e9eb9de652dc3f101b7320ceb682c60f407e2af6",
    upstreamCommit: "28c7449992ea35368e29dab9add9b368f4cba7dc",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        "import assert from 'node:assert/strict'\nimport { createRequire } from 'node:module'\n\nconst { ArgumentParser } = createRequire(import.meta.url)('../../lib/argparse.js')\n\nfunction parse (type, value) {\n  const parser = new ArgumentParser({ exit_on_error: false })\n  parser.add_argument('--v', { type })\n  return parser.parse_args([`--v=${value}`]).v\n}\n\n// Python's float() spellings the port must accept.\nassert.equal(parse('float', 'inf'), Infinity)\nassert.equal(parse('float', '-Infinity'), -Infinity)\nassert.ok(Number.isNaN(parse('float', 'nan')))\nassert.equal(parse('float', '1_000'), 1000)\n// And one it must reject.\nassert.throws(() => parse('float', '1,5'))\n// int('-0') is 0, never negative zero.\nassert.ok(Object.is(parse('int', '-0'), 0))\n\nconsole.log('visible check passed')\n",
    },
    hidden: {
      testFiles: ["test/test_port.js"],
      argv: ["node", "--test", "test/test_port.js"],
      allowedPaths: ["lib/argparse.js"],
    },
    immutable: ["test", "doc"],
    taskText:
      "This library is a port of Python's argparse, and its built-in `int` and `float` argument types (registered in lib/argparse.js with this.register('type', 'int', ...) and ('type', 'float', ...)) convert strings with a shared _string_to_number helper around Number(), which accepts and rejects different literals from CPython's int() and float() builtins. Align the two with Python 3.14: float() must accept, case-insensitively and with surrounding whitespace, 'inf', '-inf', '+inf', 'infinity' and 'nan' (returning Infinity, -Infinity and NaN), decimal literals with an optional sign, optional fraction ('5.', '.5') and optional exponent ('1e3'), and PEP 515 underscores between digits only ('1_000', '1_0.0_1e1_0', but not '1_e10', '_1' or '1__0'); it must reject everything else that Number() would take or mangle ('0x10', '0b101', '0o17', '1,5', '--5', '.', '1e', '', whitespace only) with the TypeError the type already throws for a bad literal ('could not convert string to float: %r'). int() keeps its current acceptance (decimal integers with optional sign, whitespace and digit-group underscores) and must return 0 rather than -0 for '-0'. Existing behaviour for every other input, every other type and the rest of the parser is unchanged, and the full suite (npm test: lint then the node test suite) must keep passing. Change only lib/argparse.js; do not edit tests or docs.",
  },
];

export function stageTasks(stage) {
  if (stage === "A") return tasks;
  if (stage === "B")
    return tasks
      .filter((task) => task.workType === "bugfix" || task.workType === "feature")
      .map((task) => ({ ...task, id: `${task.id}-rep` }));
  if (stage === "calibration") return calibrationTasks;
  throw new Error(`unknown stage ${stage}`);
}

/**
 * One deliberately wrong or partial implementation per task, for the validator. The bug fix's
 * is the security negative control: it strips the two ASCII line terminators before the lookup
 * and leaves U+2028 and U+2029 untouched, so the hidden cases for those must reject it.
 */
export const wrongPatches = {
  "mime-bugfix-gettype-line-terminators":
    "--- a/src/Mime.ts\n+++ b/src/Mime.ts\n@@ -72,6 +72,7 @@ export default class Mime {\n   getType(path: string) {\n     if (typeof path !== 'string') return null;\n \n+    path = path.replace(/[\\r\\n]/g, '');\n     // Remove chars preceeding `/` or `\\`\n     const last = path.replace(/^.*[/\\\\]/, '').toLowerCase();\n \n",
  "pako-feature-inflate-push-after-end":
    "--- a/src/inflate.ts\n+++ b/src/inflate.ts\n@@ -206,7 +206,7 @@ class Inflate {\n     let _flush_mode: Z_FlushMode;\n     let last_avail_out: number;\n \n-    if (this.ended) return false;\n+    if (this.ended) return true;\n \n     if (typeof flush_mode === 'number') _flush_mode = flush_mode;\n     else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;\n",
  "pako-refactor-options-default-param":
    "--- a/src/deflate.ts\n+++ b/src/deflate.ts\n@@ -158,8 +158,8 @@ class Deflate {\n    * console.log(deflate.result);\n    * ```\n    */\n-  constructor(options?: DeflateOptions) {\n-    this.options = Object.assign({}, defaultOptions, options || {});\n+  constructor(options: DeflateOptions = {}) {\n+    this.options = Object.assign({}, defaultOptions, options);\n \n     const opt = this.options;\n \n",
  "csstree-upgrade-esbuild-0-24":
    '--- a/package.json\n+++ b/package.json\n@@ -105,7 +105,7 @@\n   "devDependencies": {\n     "c8": "^7.12.0",\n     "clap": "^2.0.1",\n-    "esbuild": "^0.14.53",\n+    "esbuild": "^0.24.0",\n     "eslint": "^8.4.1",\n     "json-to-ast": "^2.1.0",\n     "mocha": "^9.2.2",\n',
  "argparse-calibration-number-conversion":
    "--- a/lib/argparse.js\n+++ b/lib/argparse.js\n@@ -2714,6 +2714,10 @@ const ArgumentParser = _callable(class ArgumentParser extends _AttributeHolder(_\n             return result\n         })\n         this.register('type', 'float', function (x) {\n+            if (typeof x === 'string') {\n+                const value = x.trim().toLowerCase()\n+                if (/^[+-]?inf(?:inity)?$/.test(value)) return value[0] === '-' ? -Infinity : Infinity\n+            }\n             const result = _string_to_number(x)\n             if (isNaN(result)) {\n                 throw new TypeError(sub('could not convert string to float: %r', x))\n",
};
