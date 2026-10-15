/**
 * The 2026-10-15 comparison's frozen task set: four maintainer-authored changes from three
 * public repositories that no earlier launch, calibration, diagnosis or repair in this repository
 * used, plus one calibration task both tools must deliver before the comparison is frozen. The
 * csstree repository carries two tasks; both are changes no earlier task here touched (the
 * earlier csstree task was the generator's raw-value whitespace). Each task's base is the parent
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
      "Mime.getType(path) (src/Mime.ts) derives a type from the extension after the last dot of the last path segment. The two regular expressions that strip the directory part and the part before the extension do not match across line terminators, so a file name that contains one is typed wrongly: getType('LINE\\nFEED.png') returns null instead of 'image/png', and the same happens for a carriage return (U+000D), a line separator (U+2028) and a paragraph separator (U+2029), with or without a directory part in front. This matters where the file name comes from an untrusted source: a content type decided from it must come from the extension after the last dot of the last segment, whatever characters precede it, so that a name crafted with a line terminator cannot make the lookup fail or pick an earlier extension. Make getType treat every line terminator like any other character when it strips the directory part and the extension's prefix; a space or tab in the name already works and must keep working. getExtension, define and the rest of the class stay as they are. The change belongs in src/Mime.ts only. Repository rules: Prettier formatting (npm run lint), no new dependencies, no edits under test or types, and the whole suite (npm test, which builds first) must keep passing.",
  },
  {
    id: "csstree-feature-parser-list-option",
    repository: "csstree/csstree",
    workType: "feature",
    baseCommit: "39a0c7289fdb5d7698f2cc066e5146ffc067d50b",
    upstreamCommit: "20f56718315e832a70d4c761ae037a78187dec29",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        "import assert from 'node:assert/strict';\nimport { parse, List } from '../../lib/index.js';\n\n// The default and an explicit `list: true` keep linked lists for children.\nassert.ok(parse('a{}').children instanceof List);\nassert.ok(parse('a{}', { list: true }).children instanceof List);\n\n// `list: false` builds plain arrays, at every level of the tree.\nconst ast = parse('a{color:red}', { list: false });\nassert.ok(Array.isArray(ast.children), 'stylesheet children');\nassert.ok(Array.isArray(ast.children[0].block.children), 'block children');\nassert.ok(Array.isArray(ast.children[0].block.children[0].value.children), 'value children');\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: ["lib/__tests/parse.js"],
      argv: ["npx", "mocha", "lib/__tests/parse.js", "--require", "lib/__tests/helpers/setup.js"],
      files: [
        {
          path: "acceptance/hidden/list-option.mjs",
          source:
            "import assert from 'node:assert/strict';\nimport { parse, generate, walk, List } from '../../lib/index.js';\n\nconst css = '@media screen and (min-width: 10px) { a:hover, b > c { color: rgb(1, 2, 3); margin: 1px 2px } } .x { --y: z }';\n\n// Arrays at every level when list is false: no List instance survives anywhere in the tree.\nconst arrays = parse(css, { list: false });\nlet lists = 0;\nlet arrayChildren = 0;\nwalk(arrays, (node) => {\n  if (node.children instanceof List) lists += 1;\n  if (Array.isArray(node.children)) arrayChildren += 1;\n});\nassert.equal(lists, 0, 'a List survived under list: false');\nassert.ok(arrayChildren >= 8, `too few array-valued children: ${arrayChildren}`);\n\n// Lists at every level by default and under list: true: no array survives.\nfor (const options of [{}, { list: true }]) {\n  const linked = parse(css, options);\n  let plain = 0;\n  walk(linked, (node) => {\n    if (Array.isArray(node.children)) plain += 1;\n  });\n  assert.equal(plain, 0, 'an array survived under list: true');\n}\n\n// The two trees serialize the same way, and a falsy non-boolean value means arrays.\nassert.equal(generate(arrays), generate(parse(css)));\nassert.ok(Array.isArray(parse('a{}', { list: 0 }).children));\nassert.ok(Array.isArray(parse('a{}', { list: null }).children));\n\n// Other options keep working beside it.\nconst raw = parse('a{b:c}', { list: false, parseValue: false });\nassert.equal(raw.children[0].block.children[0].value.type, 'Raw');\n\nconsole.log('hidden list-option check passed');\n",
        },
      ],
      extraArgv: [["node", "acceptance/hidden/list-option.mjs"]],
    },
    immutable: ["lib/__tests", "fixtures"],
    taskText:
      "The parser (lib/parser/create.js) builds every node's `children` as a linked list, an instance of the exported `List` class, through the parser's createList, createSingleNodeList, getFirstListNode and getLastListNode methods. Add a parse option named `list` so that callers can choose plain arrays instead: when `list` is omitted or truthy, children are List instances exactly as today; when `list` is a falsy value (false, 0, null), every node's children, at every depth of the tree (stylesheet, rules, blocks, declarations, values, selectors, at-rule preludes and so on), is a plain JavaScript array, and the four list methods above produce and read arrays accordingly (an empty array for a new list, a one-element array for a single-node list, the first and last element or null for the ends). The option is read where the other parse options (parseValue, parseRulePrelude, context, onComment, onToken) are read and applies to the whole parse call. Trees built either way must generate the same CSS, and all existing options must keep working beside the new one. All existing parser, generator, walker and fixture tests must keep passing; do not edit tests or fixtures, do not change the List class, and keep the change in lib/parser/create.js.",
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
        { pattern: "options: DeflateOptions = \\{\\}", files: ["src/deflate.ts"], count: 1 },
        { pattern: "options: O = \\{\\} as O", files: ["src/inflate.ts"], count: 3 },
        { pattern: "options\\?: O\\b", files: ["src/inflate.ts"], count: 0 },
      ],
      allowedPaths: ["src/inflate.ts", "src/deflate.ts"],
    },
    immutable: ["test", "benchmark"],
    taskText:
      "In src/inflate.ts and src/deflate.ts the `options` parameter is declared optional (`options?: InflateOptions`, `options?: DeflateOptions`, and `options?: O` on the inflate, inflateRaw and ungzip helpers) and every use guards against its absence with `options || {}`, `options ?? {}` or an `options && options.windowBits` test. Refactor both files so the parameter carries a default value instead and the guards go: the two class constructors declare `options: InflateOptions = {}` and `options: DeflateOptions = {}` and pass `options` straight to Object.assign; the three helper functions in inflate.ts declare `options: O = {} as O` (their generic parameter `O` loses its `= {}` default, since the value now has one) and pass `options` straight through, reading `options.toText` and `options.windowBits` directly with no intermediate `opts` variable and no truthiness guard on `options` itself. Structural requirements, each checked by regular expression after the change: `options || {}` and `options ?? {}` occur zero times across the two files; `options?: InflateOptions`, `options?: DeflateOptions` and `options?: O` occur zero times; `options: InflateOptions = {}` occurs exactly once in src/inflate.ts, `options: DeflateOptions = {}` exactly once in src/deflate.ts, and `options: O = {} as O` exactly three times in src/inflate.ts. Behaviour must be unchanged for every caller, with and without options, and the project's full check (npm test: lint, build, type-check and the node test suite) must pass as it does today. Change nothing outside these two files; do not edit tests, benchmarks or the build.",
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
        "import assert from 'node:assert/strict';\nimport { createRequire } from 'node:module';\n\nconst { ArgumentParser } = createRequire(import.meta.url)('../../lib/argparse.js');\n\nfunction parse(type, value) {\n  const parser = new ArgumentParser({ exit_on_error: false });\n  parser.add_argument('--v', { type });\n  return parser.parse_args(['--v', value]).v;\n}\n\n// Python's float() spellings the port must accept.\nassert.equal(parse('float', 'inf'), Infinity);\nassert.equal(parse('float', '-Infinity'), -Infinity);\nassert.ok(Number.isNaN(parse('float', 'nan')));\nassert.equal(parse('float', '1_000'), 1000);\n// And one it must reject.\nassert.throws(() => parse('float', '1,5'));\n// int('-0') is 0, never negative zero.\nassert.ok(Object.is(parse('int', '-0'), 0));\n\nconsole.log('visible check passed');\n",
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
  "csstree-feature-parser-list-option":
    "--- a/lib/parser/create.js\n+++ b/lib/parser/create.js\n@@ -372,6 +372,10 @@ export function createParser(config) {\n         }\n \n         const ast = parser.context[context].call(parser, options);\n+        // Only the root children are converted; nested nodes keep their lists.\n+        if ('list' in options && !options.list && ast.children && typeof ast.children.toArray === 'function') {\n+            ast.children = ast.children.toArray();\n+        }\n \n         if (!parser.eof) {\n             onParseError(new SyntaxError('Unexpected input', source, parser.tokenStart), ast);\n",
  "pako-refactor-options-default-param":
    "--- a/src/deflate.ts\n+++ b/src/deflate.ts\n@@ -158,8 +158,8 @@ class Deflate {\n    * console.log(deflate.result);\n    * ```\n    */\n-  constructor(options?: DeflateOptions) {\n-    this.options = Object.assign({}, defaultOptions, options || {});\n+  constructor(options: DeflateOptions = {}) {\n+    this.options = Object.assign({}, defaultOptions, options);\n \n     const opt = this.options;\n \n",
  "csstree-upgrade-esbuild-0-24":
    '--- a/package.json\n+++ b/package.json\n@@ -105,7 +105,7 @@\n   "devDependencies": {\n     "c8": "^7.12.0",\n     "clap": "^2.0.1",\n-    "esbuild": "^0.14.53",\n+    "esbuild": "^0.24.0",\n     "eslint": "^8.4.1",\n     "json-to-ast": "^2.1.0",\n     "mocha": "^9.2.2",\n',
  "argparse-calibration-number-conversion":
    "--- a/lib/argparse.js\n+++ b/lib/argparse.js\n@@ -2714,6 +2714,10 @@ const ArgumentParser = _callable(class ArgumentParser extends _AttributeHolder(_\n             return result\n         })\n         this.register('type', 'float', function (x) {\n+            if (typeof x === 'string') {\n+                const value = x.trim().toLowerCase()\n+                if (/^[+-]?inf(?:inity)?$/.test(value)) return value[0] === '-' ? -Infinity : Infinity\n+            }\n             const result = _string_to_number(x)\n             if (isNaN(result)) {\n                 throw new TypeError(sub('could not convert string to float: %r', x))\n",
};
