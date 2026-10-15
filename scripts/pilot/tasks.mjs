/**
 * The real-task pilot's frozen task set: four historical, maintainer-authored changes mined on
 * 2026-10-14 from three public repositories that appear in no earlier campaign, pull-request
 * pool, study frame, smoke fixture or evidence of this repository. Each task's base is the
 * parent of the upstream commit; the hidden oracle is the upstream commit's own test files
 * (overlaid from the sealed mirror at scoring time), plus the structural count for the refactor
 * and the locked and installed version for the upgrade; the visible check is one weaker
 * assertion both arms are shown. The task text was written from the change without naming it.
 *
 * Stage B repeats the bugfix and the feature unchanged under ids with the suffix "-rep".
 * `wrongPatches` holds one deliberately wrong or partial implementation per task, used only by
 * the validator to show the hidden oracle rejects a relevant mistake.
 */

export const tasks = [
  {
    id: "csstree-bugfix-raw-value-whitespace",
    repository: "csstree/csstree",
    workType: "bugfix",
    baseCommit: "85b917c679b1ccbdf93a9a9533adf66a6e2d96c5",
    upstreamCommit: "6a1646e7aa60c518e14d4ca95aff57c813fcfe70",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        "import assert from 'node:assert/strict';\nimport { parse, generate } from '../../lib/index.js';\n\n// A declaration value kept as a raw string (parseValue: false) must be\n// serialized verbatim, without automatic whitespace between its tokens.\nconst ast = parse('a{border:1%var(--a)#ff0000}', { parseValue: false });\nassert.equal(generate(ast), 'a{border:1%var(--a)#ff0000}');\n\n// Parsed values still get the whitespace needed to keep tokens apart.\nconst parsed = parse('a{border:1%var(--a)#ff0000}');\nassert.equal(generate(parsed), 'a{border:1% var(--a) #ff0000}');\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: ["lib/__tests/generate.js"],
      argv: [
        "npx",
        "mocha",
        "lib/__tests/generate.js",
        "--require",
        "lib/__tests/helpers/setup.js",
      ],
    },
    immutable: ["lib/__tests", "fixtures"],
    taskText:
      "The CSS generator (lib/generator) automatically inserts a space between two adjacent tokens when leaving them adjacent would change how the text tokenizes (for example `1%` followed by `var(` or `#ff0000`). That rule is correct for values the parser turned into nodes, but it is also applied to Raw nodes, whose string value is re-tokenized on output. A raw value is text the parser deliberately left untouched (for example when parsing with `parseValue: false` or `parseRulePrelude: false`), so it must be emitted exactly as written. Today `generate(parse('span#foo { border: 1%var(--a)#ff0000; }', { parseRulePrelude: false, parseValue: false }))` returns `span #foo{border:1% var(--a) #ff0000}`; it must return `span#foo{border:1%var(--a)#ff0000}`. Automatic whitespace must still be inserted where a raw value meets its surroundings (the space in `@media screen` when the prelude is raw must stay) and for fully parsed values: `generate(parse('span#foo { border: 1%var(--a)#ff0000; }'))` must still give `span#foo{border:1% var(--a) #ff0000}`. The change belongs in lib/generator (create.js and its token-before logic). All existing generate, round-trip and source-map tests must keep passing; do not edit tests or fixtures.",
  },
  {
    id: "chai-feature-deep-contain-oneof",
    repository: "chaijs/chai",
    workType: "feature",
    baseCommit: "f178cfb2cdff210f478e881528dcba9e007b9e3e",
    upstreamCommit: "4225e809708f7ea8fef9fed2e55652f765caaf3a",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [["npm", "run", "build"]],
    projectTest: ["npm", "run", "test-node"],
    visiblePrefix: "npm run build && ",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "npm run build && node acceptance/visible/check.mjs",
      source:
        "import * as chai from '../../index.js';\nimport assert from 'node:assert/strict';\n\nchai.expect([[1], [2]]).to.deep.contain.oneOf([[1], [2]]);\nchai.expect([[3], [4]]).to.not.deep.contain.oneOf([[1], [2]]);\nassert.throws(() => chai.expect([[1]]).to.deep.contain.oneOf([[2]]));\nchai.expect([1, 2]).to.contain.oneOf([4, 2, 5]);\nchai.expect([[1]]).to.not.contain.oneOf([[1]]);\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: ["test/expect.js"],
      argv: ["npx", "mocha", "--require", "./test/bootstrap/index.js", "test/expect.js"],
    },
    immutable: ["test"],
    taskText:
      'chai\'s `.oneOf(list)` assertion (function oneOf in lib/chai/core/assertions.js) has a `contain`/`include` form that asserts the subject array or string contains at least one member of the list. That form only uses strict identity via indexOf, so the `deep` flag has no effect: expect([[1], [2]]).to.deep.contain.oneOf([[1], [2]]) currently fails with "expected [ [ 1 ], [ 2 ] ] to contain one of [ [ 1 ], [ 2 ] ]". Add deep support to the contain form. When the `deep` flag is set and the subject is an array, a list member counts as contained if any subject element is deep-equal to it (use the same deep-equality utility the file already uses for other deep assertions); without the deep flag the current strict behavior must be unchanged, so expect([[1]]).to.not.contain.oneOf([[1]]) still passes. The failure messages for the contain form must say "deeply" when the deep flag is set: expect([[1]]).to.deep.contain.oneOf([[2]]) must throw "expected [ [ 1 ] ] to deeply contain one of [ [ 2 ] ]" and expect([[1]]).to.not.deep.contain.oneOf([[1]]) must throw "expected [ [ 1 ] ] to not deeply contain one of [ [ 1 ] ]". Nested cases such as expect([[[1]]]).to.deep.contain.oneOf([[[1]]]) must pass. String subjects, the non-contain form of oneOf, the list-must-be-an-array check and all existing messages stay as they are. Do not edit the test directory.',
  },
  {
    id: "lru-cache-refactor-autopurge-noop-timer",
    repository: "isaacs/node-lru-cache",
    workType: "refactor",
    baseCommit: "879f8b11c780117f305b04692c84ec699b281c5a",
    upstreamCommit: "2ec0b52433e7d77e962598e344d01e47897e87b5",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [["npm", "run", "prepare"]],
    projectTest: ["npx", "tap"],
    visiblePrefix: "npm run prepare && ",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "npm run prepare && node acceptance/visible/check.mjs",
      source:
        "import { readFileSync } from 'node:fs';\nimport assert from 'node:assert/strict';\nimport { LRUCache } from '../../dist/esm/index.js';\n\nconst source = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');\nconst matches = source.match(/!this\\.ttlAutopurge \\?/g) ?? [];\nassert.equal(matches.length, 1, 'expected exactly one `!this.ttlAutopurge ?` guard in src/index.ts');\n\nconst plain = new LRUCache({ max: 5, ttl: 1000, ttlAutopurge: false });\nplain.set('a', 1);\nassert.equal(plain.get('a'), 1);\nconst purging = new LRUCache({ max: 5, ttl: 1000, ttlAutopurge: true });\npurging.set('b', 2);\nassert.equal(purging.get('b'), 2);\npurging.clear();\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: [],
      argv: ["npx", "tap"],
      structural: [
        {
          pattern: "!this\\.ttlAutopurge \\?",
          files: ["src/index.ts"],
          count: 1,
        },
        {
          pattern: "setPurgetTimer",
          files: ["src/index.ts"],
          count: 3,
        },
      ],
    },
    immutable: ["test", "tap-snapshots"],
    taskText:
      "In src/index.ts the LRUCache constructor's TTL initialization defines a local helper, setPurgetTimer, that clears and reschedules the per-entry autopurge timeout; it is called from the setItemTTL and updateItemAge closures. Today the helper always runs its clearTimeout/setTimeout logic, even when the cache was created without ttlAutopurge, in which case purgeTimers is undefined and every call does nothing useful. Restructure the helper so that the decision is made once at construction time: bind setPurgetTimer to a no-op function when this.ttlAutopurge is falsy, and to the existing timer-managing arrow function otherwise, using a single conditional expression written exactly as `!this.ttlAutopurge ?` followed by the no-op branch and then the real implementation. Structural requirement: after the change the regex `!this\\.ttlAutopurge \\?` must match exactly once in src/index.ts (it matches zero times today), and the identifier setPurgetTimer must still appear exactly three times (its definition and its two call sites). Behavior must be unchanged: the full tap suite must pass as it does today, TTL autopurge must still expire entries when ttlAutopurge is true, and no public API, exported type or test or snapshot file may be modified.",
  },
  {
    id: "chai-upgrade-c8-v12",
    repository: "chaijs/chai",
    workType: "upgrade",
    baseCommit: "8ff359fbfd3a12792d7e9247391063e27305fddd",
    upstreamCommit: "d9d00c3697c467266136103f6957524f3d6e3e8b",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [["npm", "run", "build"]],
    projectTest: ["npm", "run", "test-node"],
    visiblePrefix: "npm run build && ",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "npm run build && node acceptance/visible/check.mjs",
      source:
        "import { readFileSync } from 'node:fs';\nimport assert from 'node:assert/strict';\n\nconst pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));\nassert.ok(['12.0.0', '^12.0.0'].includes(pkg.devDependencies.c8), pkg.devDependencies.c8);\nconst lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));\nassert.equal(lock.packages['node_modules/c8'].version, '12.0.0');\nassert.ok(['12.0.0', '^12.0.0'].includes(lock.packages[''].devDependencies.c8), lock.packages[''].devDependencies.c8);\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: [],
      argv: ["npm", "run", "test-node"],
      upgrade: [
        {
          name: "c8",
          section: "devDependencies",
          version: "12.0.0",
        },
      ],
    },
    upgradeSourcePaths: [],
    immutable: ["test"],
    taskText:
      'Upgrade the c8 coverage tool used by this project\'s node test script. In package.json the devDependency "c8" is currently "^11.0.0"; change it to exactly "12.0.0" (declare "12.0.0", no range) and regenerate package-lock.json with npm so that the lockfile resolves c8 to version 12.0.0 and npm ci installs 12.0.0 (the root package entry in the lockfile must record the same declaration). The project\'s node test command, `npm run test-node` (c8 --99 --check-coverage mocha --require ./test/bootstrap/index.js test/*.js, after npm run build), must continue to run and pass after the upgrade; the project already pins yargs ^18 for c8 through the package.json overrides block, which must be kept. Do not change any other dependency, do not edit the library sources under lib or the test directory, and do not alter the test-node script itself.',
  },
];

export function stageTasks(stage) {
  if (stage === "A") return tasks;
  if (stage === "B")
    return tasks
      .filter((task) => task.workType === "bugfix" || task.workType === "feature")
      .map((task) => ({ ...task, id: `${task.id}-rep` }));
  throw new Error(`unknown stage ${stage}`);
}

export const wrongPatches = {
  "csstree-bugfix-raw-value-whitespace":
    "--- a/lib/generator/create.js\n+++ b/lib/generator/create.js\n@@ -87,7 +87,8 @@ export function createGenerator(config) {\n             node: (node) => handlers.node(node),\n             children: processChildren,\n             token: (type, value) => handlers.token(type, value),\n-            tokenize: processChunk\n+            // raw values are emitted verbatim, without auto whitespace insertion\n+            tokenize: (raw) => handlers.emit(raw)\n         };\n \n         handlers.node(node);\n",
  "chai-feature-deep-contain-oneof":
    "diff --git a/lib/chai/core/assertions.js b/lib/chai/core/assertions.js\n--- a/lib/chai/core/assertions.js\n+++ b/lib/chai/core/assertions.js\n@@ -3391,6 +3391,11 @@ function oneOf(list, msg) {\n   if (contains) {\n     this.assert(\n       list.some(function (possibility) {\n+        if (isDeep && Array.isArray(expected)) {\n+          return expected.some(function (item) {\n+            return eql(item, possibility);\n+          });\n+        }\n         return expected.indexOf(possibility) > -1;\n       }),\n       'expected #{this} to contain one of #{exp}',\n",
  "lru-cache-refactor-autopurge-noop-timer":
    "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1555,7 +1555,7 @@ export class LRUCache<K extends {}, V extends {}, FC = unknown> {\n     // clear out the purge timer if we're setting TTL to 0, and\n     // previously had a ttl purge timer running, so it doesn't\n     // fire unnecessarily.\n-    const setPurgetTimer = (index: Index, ttl?: number) => {\n+    const setPurgetTimer = !this.ttlAutopurge ? (index: Index, ttl?: number) => {\n       if (purgeTimers?.[index]) {\n         clearTimeout(purgeTimers[index])\n         purgeTimers[index] = undefined\n@@ -1574,7 +1574,7 @@ export class LRUCache<K extends {}, V extends {}, FC = unknown> {\n         /* c8 ignore stop */\n         purgeTimers[index] = t\n       }\n-    }\n+    } : () => {}\n \n     this.#statusTTL = (status, index) => {\n       if (ttls[index]) {\n",
  "chai-upgrade-c8-v12":
    '--- a/package.json\n+++ b/package.json\n@@ -60,7 +60,7 @@\n     "@web/test-runner": "^1.0.0",\n     "@web/test-runner-playwright": "^1.0.0",\n     "assertion-error": "^2.0.1",\n-    "c8": "^11.0.0",\n+    "c8": "^12.0.0",\n     "check-error": "^2.1.1",\n     "deep-eql": "^5.0.1",\n     "esbuild": "^0.28.0",\n',
};
