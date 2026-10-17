/**
 * The task set of the 2026-10-16 follow-up assignment.
 *
 * Development stages reuse two tasks of the 2026-10-15 set unchanged under new ids, so no cell
 * here can be read as a cell of that comparison: `dev` is the mime bug fix and the pako refactor,
 * `dev-mime` the mime bug fix alone. Both are exposed development cases (their outcomes and the
 * mime audit's counterexamples are known), so nothing recorded from them is comparative evidence.
 *
 * Stage `A` is the fresh comparison: four maintainer-merged changes from four public repositories
 * that appear nowhere else in this repository, one of each kind, each run twice per tool under
 * ids with the suffixes `-r1` and `-r2`. Selection criteria, the pool and the exclusions were
 * declared before either tool attempted any of them, in
 * docs/evidence/2026-10-16/fresh-comparison/candidates.md. The hidden oracle is the upstream
 * commit's own tests overlaid at scoring time plus the structural, version and task-authored
 * checks named here; the visible check is one weaker assertion both tools are shown.
 * `wrongPatches` holds one plausible wrong or partial implementation per task, for the validator.
 */
import { tasks as earlier, wrongPatches as earlierWrongPatches } from "./tasks-2026-10-15.mjs";

const reuse = (id, suffix) => {
  const task = earlier.find((one) => one.id === id);
  if (task === undefined) throw new Error(`no task ${id} in the 2026-10-15 set`);
  return { ...task, id: `${id}${suffix}` };
};

export const developmentTasks = {
  dev: [
    reuse("mime-bugfix-gettype-line-terminators", "-dev"),
    reuse("pako-refactor-options-default-param", "-dev"),
  ],
  "dev-mime": [reuse("mime-bugfix-gettype-line-terminators", "-dev-plan")],
};

/** The four fresh tasks, once each; stage A runs each under two repetition ids. */
export const tasks = [
  {
    id: "tar-bugfix-negative-size",
    repository: "isaacs/node-tar",
    workType: "bugfix",
    baseCommit: "e02a4e9e013c4be95302e2eb2047a942b883c27b",
    upstreamCommit: "9e78bf058b2c22dd4d52e00d8922d5c06fc2f7b5",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [["npm", "run", "prepare"]],
    projectTest: ["npm", "test", "--", "--allow-incomplete-coverage"],
    visiblePrefix: "npm run prepare && ",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "npm run prepare && node acceptance/visible/check.mjs",
      source:
        "import assert from 'node:assert/strict';\nimport { Header } from '../../dist/esm/header.js';\n\n// A negative size is refused rather than recorded.\nassert.equal(new Header({ size: -1000 }).size, undefined);\nassert.equal(new Header({ size: 1000 }).size, 1000);\n\nconsole.log('visible check passed');\n",
    },
    hidden: {
      testFiles: ["test/header.js", "test/pax.js"],
      argv: ["npx", "tap", "--disable-coverage", "--timeout=60", "test/header.js", "test/pax.js"],
      files: [
        {
          path: "acceptance/hidden/negative-size.mjs",
          source:
            "// Hidden extra for the node-tar negative-size task (run after `npm run prepare`).\nimport assert from 'node:assert/strict';\nimport { pathToFileURL } from 'node:url';\nimport { join } from 'node:path';\n\nconst dir = process.cwd();\nconst { Header } = await import(pathToFileURL(join(dir, 'dist/esm/header.js')));\nconst { Pax } = await import(pathToFileURL(join(dir, 'dist/esm/pax.js')));\nconst large = await import(pathToFileURL(join(dir, 'dist/esm/large-numbers.js')));\n\n// A raw header block whose size field holds a base-256 negative number.\nconst good = new Header({ path: 'x', type: 'File', size: 10, mode: 0o644, mtime: new Date(0) });\ngood.encode();\nconst block = Buffer.from(good.block);\nlarge.encode(-1000, block.subarray(124, 136));\nassert.equal(new Header(block).size, undefined, 'negative size in the block');\n\n// Extended-header sizes: a negative or non-numeric one is never taken.\nassert.equal(new Header(block, 0, { size: -5 }).size, undefined, 'negative ex size');\nassert.equal(new Header(Buffer.from(good.block), 0, { size: 42 }).size, 42, 'ex size wins');\nassert.equal(new Header(Buffer.from(good.block)).size, 10, 'block size kept');\n\n// Zero is a valid size everywhere.\nassert.equal(new Header({ size: 0 }).size, 0);\nassert.equal(Pax.parse('10 size=0\\n').size, 0);\nassert.equal(Pax.parse('11 size=-1\\n').size, undefined);\nassert.equal(Pax.parse('12 size=abc\\n').size, undefined);\n// Other numeric pax fields are unchanged.\nassert.equal(Pax.parse('10 uid=-1\\n').uid, -1);\nassert.equal(Pax.parse('12 mtime=10\\n').mtime.getTime(), 10000);\n\nconsole.log('tar negative size extra passed');\n",
        },
      ],
      extraArgv: [["node", "acceptance/hidden/negative-size.mjs"]],
      allowedPaths: ["src/header.ts", "src/pax.ts"],
    },
    immutable: ["test", "scripts"],
    taskText:
      "A tar entry's size comes from the 12-byte size field of its header block (octal, or base-256 for large and negative numbers), from a pax extended header's 'size' record, or from a global extended header. Nothing stops any of them from being negative, and a negative size makes the reader miscount the bytes that follow the header. Refuse negative sizes in src/header.ts and src/pax.ts. In the Header class: when a block is decoded, the size it computes (the extended header's size, else the global extended header's size, else the block's own size field) becomes undefined if it is negative; and header data whose size is negative when compared as a number, whether passed to the constructor (new Header({ size: -1000 })) or merged in from an extended header, is ignored, so header.size stays undefined. In Pax.parse, a 'size' record is kept only when its numeric value is zero or greater: 'size=-1000' and a non-numeric value leave size undefined, while 'size=1000' gives 1000 and 'size=0' gives 0. Every other field (uid, gid, mode, the times and so on) keeps its current parsing, negative values included, and nothing else changes. Change only src/header.ts and src/pax.ts; do not edit tests. The tests import the built dist, so build with npm run prepare (tshy and an esbuild bundle) before running them; npm test runs prepare and then tap. The suite's assertions must keep passing: npm test -- --allow-incomplete-coverage (tap's 100% coverage rule already fails at the current commit on one branch of src/pax.ts, so it is not a rule here).",
  },
  {
    id: "css-select-feature-lang",
    repository: "fb55/css-select",
    workType: "feature",
    baseCommit: "cd6625464a17281794a65cb034833c6e2f85856f",
    upstreamCommit: "b77508c9fa4523207628f07c5318ac1168a26eeb",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [["npm", "run", "build"]],
    projectTest: ["npm", "test"],
    visiblePrefix: "npm run build && ",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "npm run build && node acceptance/visible/check.mjs",
      source:
        'import assert from "node:assert/strict";\nimport { parseDocument } from "htmlparser2";\n\n// The built package (`npm run build` writes dist).\nconst { selectAll } = await import(\n    new URL("../../dist/index.js", import.meta.url).href\n);\n\nconst dom = parseDocument(\n    \'<div lang="en-US"><p id="a">A</p></div><p id="b" lang="fr">B</p><p id="c">C</p>\',\n);\n\n// A range matches its own tag and longer tags, inherited from ancestors.\nconst ids = selectAll("p:lang(en)", dom).map((element) => element.attribs.id);\nassert.deepEqual(ids, ["a"]);\n\nconsole.log("visible check passed");\n',
    },
    hidden: {
      testFiles: ["test/pseudo-classes.ts"],
      argv: ["npx", "vitest", "run", "test/pseudo-classes.ts"],
      allowedPaths: ["src/pseudo-selectors/filters.ts"],
    },
    immutable: ["test", "src/__fixtures__"],
    taskText:
      'css-select does not support the :lang() pseudo-class: compiling a selector that uses it throws \'Unknown pseudo-class :lang\'. Add it as a filter in src/pseudo-selectors/filters.ts, following Selectors Level 4. The argument is a comma-separated list of language ranges; each range is trimmed, an empty entry is ignored, surrounding single or double quotes are removed, and matching is case-insensitive. An element\'s language is the value of its own xml:lang attribute if it has one, else its own lang attribute, else the same lookup on its nearest element ancestor. An element with no such attribute on itself or any ancestor, or whose nearest value is the empty string (lang=""), matches only an empty range (such as :lang("")). A range matches a language tag by RFC 4647 extended filtering over the hyphen-separated subtags: the first subtags must be equal unless the range\'s first subtag is \'*\'; then each later range subtag that is not \'*\' must be found, in order, among the tag\'s remaining subtags, where tag subtags of two or more characters may be skipped but reaching a one-character (singleton) subtag fails the match; later \'*\' range subtags are skipped. So :lang(en) matches elements with lang="en" or lang="en-US" (and their descendants without their own lang) but not lang="eng"; :lang(de-DE) matches "de-DE", "de-Latn-DE" and "de-Latn-DE-1996"; :lang(\\*-CH) matches "de-CH" and "fr-CH" but not "fr-FR"; :lang(en, fr) matches either language. The filter composes with the rest of a compound selector like the other filters (for example p:lang(en)). Nothing else changes. Change only src/pseudo-selectors/filters.ts; do not edit tests. The full check (npm test: vitest, then eslint, biome and tsc) must pass.',
  },
  {
    id: "json5-refactor-parse-state-switch",
    repository: "json5/json5",
    workType: "refactor",
    baseCommit: "9161244d393aa6bb0bfe4ee86f89713c93d4d308",
    upstreamCommit: "61803cb5df4b787f0624086c62e4d45cf6b7725f",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        "import { readFileSync } from 'node:fs'\nimport assert from 'node:assert/strict'\nimport * as JSON5 from '../../lib/index.js'\n\nconst source = readFileSync(new URL('../../lib/parse.js', import.meta.url), 'utf8')\n// The parse-state table is gone.\nassert.equal((source.match(/^const parseStates\\b/gm) ?? []).length, 0, 'lib/parse.js still declares parseStates')\n\n// Parsing is unchanged.\nassert.deepEqual(JSON5.parse(\"{a: [1, 'two', {b: null}], c: +Infinity,}\"), { a: [1, 'two', { b: null }], c: Infinity })\nassert.throws(() => JSON5.parse('{a: 1'), /invalid end of input/)\n\nconsole.log('visible check passed')\n",
    },
    hidden: {
      testFiles: [],
      argv: ["npm", "test"],
      extraArgv: [["npm", "run", "lint"]],
      structural: [
        {
          pattern: "(?<=^|\n)const parseStates\\b",
          files: ["lib/parse.js"],
          count: 0,
        },
        {
          pattern: "(?<=^|\n)[^/\\n]*parseStates\\[",
          files: ["lib/parse.js"],
          count: 0,
        },
        {
          pattern: "(?<=^|\n)function processParseState \\(state\\) \\{(?=\n|$)",
          files: ["lib/parse.js"],
          count: 1,
        },
        {
          pattern: "(?<=^|\n)[ \\t]*processParseState\\(parseState\\)(?=\n|$)",
          files: ["lib/parse.js"],
          count: 1,
        },
        {
          pattern: "(?<=^|\n)    case 'start': \\{(?=\n|$)",
          files: ["lib/parse.js"],
          count: 2,
        },
        {
          pattern: "(?<=^|\n)    case 'beforePropertyName': \\{(?=\n|$)",
          files: ["lib/parse.js"],
          count: 2,
        },
        {
          pattern: "(?<=^|\n)    case 'afterPropertyName': \\{(?=\n|$)",
          files: ["lib/parse.js"],
          count: 2,
        },
        {
          pattern: "(?<=^|\n)    case 'beforePropertyValue': \\{(?=\n|$)",
          files: ["lib/parse.js"],
          count: 2,
        },
        {
          pattern: "(?<=^|\n)    case 'afterPropertyValue': \\{(?=\n|$)",
          files: ["lib/parse.js"],
          count: 2,
        },
        {
          pattern: "(?<=^|\n)    case 'beforeArrayValue': \\{(?=\n|$)",
          files: ["lib/parse.js"],
          count: 2,
        },
        {
          pattern: "(?<=^|\n)    case 'afterArrayValue': \\{(?=\n|$)",
          files: ["lib/parse.js"],
          count: 2,
        },
        {
          pattern: "(?<=^|\n)    case 'end': \\{(?=\n|$)",
          files: ["lib/parse.js"],
          count: 2,
        },
      ],
      allowedPaths: ["lib/parse.js", "CHANGELOG.md"],
    },
    immutable: ["test", "build"],
    taskText:
      "lib/parse.js dispatches its parser states through a `parseStates` object whose methods (start, beforePropertyName, afterPropertyName, beforePropertyValue, beforeArrayValue, afterPropertyValue, afterArrayValue, end) the parse loop calls as parseStates[parseState](). The lexer states in the same file were already converted from such a table to `function processLexState (state)` holding a single `switch (state)`. Convert the parser states the same way, for performance: replace the object with `function processParseState (state) {` containing one `switch (state)` with a block-scoped case per state (`case 'start': {` and so on) at the same four-space indentation the lexer's cases use, each case returning where the method returned, and call it as `processParseState(parseState)` from the loop. Structural requirements, checked by regular expression on lib/parse.js after the change: no line starts with `const parseStates`; no uncommented `parseStates[` remains; `function processParseState (state) {` occurs exactly once at the start of a line and `processParseState(parseState)` exactly once as a statement of its own; and each of the eight state names occurs exactly twice as a line `    case '<name>': {` (once in the lexer's switch, once in the new one). The state bodies and every parse result and error are unchanged. npm test (which builds, runs the node test suite and enforces 100% line, branch and function coverage of lib, so no unreachable default branch may be added) and npm run lint must pass. Change only lib/parse.js (a CHANGELOG.md entry is welcome); do not edit tests.",
  },
  {
    id: "domutils-upgrade-htmlparser2-12",
    repository: "fb55/domutils",
    workType: "upgrade",
    baseCommit: "0f1175d1541e844af78a1f612fc5dd661ff32009",
    upstreamCommit: "2ff95709d8d769834f0e3d9b56000b13bf961fff",
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        'import { readFileSync } from "node:fs";\nimport assert from "node:assert/strict";\n\nconst package_ = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));\nassert.equal(package_.devDependencies.htmlparser2, "12.0.0", package_.devDependencies.htmlparser2);\nconst lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));\nassert.equal(lock.packages["node_modules/htmlparser2"].version, "12.0.0");\nassert.equal(lock.packages[""].devDependencies.htmlparser2, "12.0.0");\nconst installed = JSON.parse(readFileSync(new URL("../../node_modules/htmlparser2/package.json", import.meta.url), "utf8"));\nassert.equal(installed.version, "12.0.0");\n\nconsole.log("visible check passed");\n',
    },
    hidden: {
      testFiles: [],
      argv: ["npm", "test"],
      upgrade: [
        {
          name: "htmlparser2",
          section: "devDependencies",
          version: "12.0.0",
          declared: "12.0.0",
        },
      ],
      unchanged: ["scripts", "dependencies"],
      files: [
        {
          path: "acceptance/hidden/htmlparser2-effect.mjs",
          source:
            "// Hidden effect check for the htmlparser2 12 upgrade: run against the project's sources through\n// vitest-free node, using the installed htmlparser2 the tests build their fixtures with.\nimport assert from 'node:assert/strict';\nimport { createRequire } from 'node:module';\nimport { join } from 'node:path';\nimport { pathToFileURL } from 'node:url';\n\nconst dir = process.cwd();\nconst require = createRequire(join(dir, 'package.json'));\nconst { parseDocument } = await import(pathToFileURL(require.resolve('htmlparser2')));\n// htmlparser2 12 rewrites <image> to <img> outside foreign content and treats\n// <iframe> content as raw text; 11 did neither.\nconst dom = parseDocument('<p><image src=\"a.png\"><iframe><b>x</b></iframe></p>');\nconst tags = [];\n(function walk(nodes) { for (const n of nodes) { if (n.type === 'tag') tags.push(n.name); if (n.children) walk(n.children); } })(dom.children);\nassert.deepEqual(tags, ['p', 'img', 'iframe'], `parsed tags ${tags.join(',')}`);\nconsole.log('htmlparser2 12 effect check passed');\n",
        },
      ],
      extraArgv: [["node", "acceptance/hidden/htmlparser2-effect.mjs"]],
      allowedPaths: ["package.json", "package-lock.json"],
    },
    upgradeSourcePaths: [],
    immutable: ["src"],
    taskText:
      'Upgrade the htmlparser2 parser this project\'s tests build their DOM fixtures with. In package.json the devDependency "htmlparser2" is currently "~11.0.0"; change it to exactly "12.0.0" (declare "12.0.0", no range) and regenerate package-lock.json with npm so that the lockfile resolves htmlparser2 to 12.0.0, its root package entry records the same declaration, and npm ci installs 12.0.0. htmlparser2 12 aligns HTML parsing with the WHATWG specification (for example <image> becomes <img> and <iframe> content is raw text); the full check (npm test: vitest, then eslint, tsc and biome) must pass against it. Do not change any other dependency declaration, the scripts block or anything under src; the change is package.json and package-lock.json only.',
  },
];

/** The repetition suffixes of stage A, in launch order. */
export const repetitions = ["-r1", "-r2"];

export const stagePurposes = {
  A: "the fresh comparison: four tasks, two tools, two repetitions each, counterbalanced",
  dev: "development measurement on two exposed tasks: the mime bug fix and the pako refactor, Swarm only, under one named product configuration per manifest; not comparative evidence",
  "dev-mime":
    "development demonstration on the exposed mime bug fix under --plan-checks, Swarm only; the planner sees the task text and the repository, never the audit's counterexamples; not comparative evidence",
};

export function stageTasks(stage) {
  if (stage === "A")
    return repetitions.flatMap((suffix) =>
      tasks.map((task) => ({ ...task, id: `${task.id}${suffix}` })),
    );
  const development = developmentTasks[stage];
  if (development !== undefined) return development;
  throw new Error(`unknown stage ${stage}`);
}

const freshWrongPatches = {
  "tar-bugfix-negative-size":
    "diff --git a/src/header.ts b/src/header.ts\nindex 27503e4..05e394f 100644\n--- a/src/header.ts\n+++ b/src/header.ts\n@@ -8,6 +8,9 @@ import * as large from './large-numbers.js'\n import type { EntryTypeCode, EntryTypeName } from './types.js'\n import * as types from './types.js'\n \n+const notNegative = (n?: number): number | undefined =>\n+  n === undefined || n < 0 ? undefined : n\n+\n export type HeaderData = {\n   path?: string\n   mode?: number\n@@ -103,10 +106,12 @@ export class Header implements HeaderData {\n       exForFields?.uid ?? gexForFields?.uid ?? decNumber(buf, off + 108, 8)\n     this.gid =\n       exForFields?.gid ?? gexForFields?.gid ?? decNumber(buf, off + 116, 8)\n-    this.size =\n+\n+    this.size = notNegative(\n       exForFields?.size ??\n-      gexForFields?.size ??\n-      decNumber(buf, off + 124, 12)\n+        gexForFields?.size ??\n+        decNumber(buf, off + 124, 12),\n+    )\n     this.mtime =\n       exForFields?.mtime ??\n       gexForFields?.mtime ??\n@@ -203,6 +208,7 @@ export class Header implements HeaderData {\n           return !(\n             v === null ||\n             v === undefined ||\n+            (k === 'size' && Number(v) < 0) ||\n             (k === 'path' && gex) ||\n             (k === 'linkpath' && gex) ||\n             k === 'global'\n",
  "css-select-feature-lang":
    'diff --git a/src/pseudo-selectors/filters.ts b/src/pseudo-selectors/filters.ts\nindex 6fe3738..8d69d4b 100644\n--- a/src/pseudo-selectors/filters.ts\n+++ b/src/pseudo-selectors/filters.ts\n@@ -175,6 +175,41 @@ export const filters: Record<string, Filter> = {\n         return (element) => context.includes(element) && next(element);\n     },\n \n+    lang(next, code, { adapter }) {\n+        const ranges = code\n+            .split(",")\n+            .map((r) => r.trim().replace(/^[\'"]|[\'"]$/g, "").toLowerCase())\n+            .filter((r) => r.length > 0);\n+\n+        return function lang(element) {\n+            let node: typeof element | null = element;\n+\n+            while (node != null) {\n+                const value =\n+                    adapter.getAttributeValue(node, "xml:lang") ??\n+                    adapter.getAttributeValue(node, "lang");\n+\n+                if (value != null) {\n+                    const tag = value.toLowerCase();\n+                    // Same as the `|=` attribute operator: exact or followed by a hyphen.\n+                    return (\n+                        ranges.some(\n+                            (r) => tag === r || tag.startsWith(`${r}-`),\n+                        ) && next(element)\n+                    );\n+                }\n+\n+                const parent = adapter.getParent(node);\n+                node =\n+                    parent != null && adapter.isTag(parent)\n+                        ? (parent as typeof element)\n+                        : null;\n+            }\n+\n+            return false;\n+        };\n+    },\n+\n     hover: dynamicStatePseudo("isHovered"),\n     visited: dynamicStatePseudo("isVisited"),\n     active: dynamicStatePseudo("isActive"),\n',
  "json5-refactor-parse-state-switch":
    "diff --git a/lib/parse.js b/lib/parse.js\nindex 7c1e3d7..f4fdf8d 100644\n--- a/lib/parse.js\n+++ b/lib/parse.js\n@@ -39,7 +39,7 @@ export function parse (text, reviver) {\n         //     throw invalidParseState()\n         // }\n \n-        parseStates[parseState]()\n+        processParseState(parseState)\n     } while (tokenType !== TOKEN_EOF)\n \n     if (typeof reviver === 'function') {\n@@ -857,16 +857,18 @@ function unicodeEscape () {\n     return String.fromCodePoint(parseInt(buffer, 16))\n }\n \n-const parseStates = {\n-    start () {\n+function processParseState (state) {\n+    switch (state) {\n+    case 'start': {\n         if (tokenType === TOKEN_EOF) {\n             throw invalidEOF()\n         }\n \n         push()\n-    },\n+        return\n+    }\n \n-    beforePropertyName () {\n+    case 'beforePropertyName': {\n         switch (tokenType) {\n         case TOKEN_IDENTIFIER:\n         case TOKEN_STRING:\n@@ -887,11 +889,13 @@ const parseStates = {\n             throw invalidEOF()\n         }\n \n+        return\n+\n         // This code is unreachable since it's handled by the lexState.\n         // throw invalidToken()\n-    },\n+    }\n \n-    afterPropertyName () {\n+    case 'afterPropertyName': {\n         // This code is unreachable since it's handled by the lexState.\n         // if (tokenType !== TOKEN_PUNCTUATOR || tokenValue !== ':') {\n         //     throw invalidToken()\n@@ -902,17 +906,18 @@ const parseStates = {\n         }\n \n         parseState = 'beforePropertyValue'\n-    },\n+        return\n+    }\n \n-    beforePropertyValue () {\n+    case 'beforePropertyValue': {\n         if (tokenType === TOKEN_EOF) {\n             throw invalidEOF()\n         }\n \n         push()\n-    },\n+    }\n \n-    beforeArrayValue () {\n+    case 'beforeArrayValue': {\n         if (tokenType === TOKEN_EOF) {\n             throw invalidEOF()\n         }\n@@ -923,9 +928,10 @@ const parseStates = {\n         }\n \n         push()\n-    },\n+        return\n+    }\n \n-    afterPropertyValue () {\n+    case 'afterPropertyValue': {\n         // This code is unreachable since it's handled by the lexState.\n         // if (tokenType !== TOKEN_PUNCTUATOR) {\n         //     throw invalidToken()\n@@ -944,11 +950,13 @@ const parseStates = {\n             pop()\n         }\n \n+        return\n+\n         // This code is unreachable since it's handled by the lexState.\n         // throw invalidToken()\n-    },\n+    }\n \n-    afterArrayValue () {\n+    case 'afterArrayValue': {\n         // This code is unreachable since it's handled by the lexState.\n         // if (tokenType !== TOKEN_PUNCTUATOR) {\n         //     throw invalidToken()\n@@ -967,16 +975,21 @@ const parseStates = {\n             pop()\n         }\n \n+        return\n+\n         // This code is unreachable since it's handled by the lexState.\n         // throw invalidToken()\n-    },\n+    }\n \n-    end () {\n+    case 'end': {\n         // This code is unreachable since it's handled by the lexState.\n         // if (tokenType !== TOKEN_EOF) {\n         //     throw invalidToken()\n         // }\n-    },\n+\n+        return\n+    }\n+    }\n }\n \n function push () {\n",
  "domutils-upgrade-htmlparser2-12":
    'diff --git a/package-lock.json b/package-lock.json\nindex 6d02550..b55f7c5 100644\n--- a/package-lock.json\n+++ b/package-lock.json\n@@ -20,7 +20,7 @@\n                 "@types/node": "^25.5.0",\n                 "eslint": "^10.0.3",\n                 "eslint-config-biome": "^2.1.3",\n-                "htmlparser2": "~11.0.0",\n+                "htmlparser2": "^12.0.0",\n                 "typedoc": "^0.28.19",\n                 "typescript": "^6.0.2",\n                 "typescript-eslint": "^8.62.0",\n@@ -2408,9 +2408,9 @@\n             "license": "MIT"\n         },\n         "node_modules/htmlparser2": {\n-            "version": "11.0.0",\n-            "resolved": "https://registry.npmjs.org/htmlparser2/-/htmlparser2-11.0.0.tgz",\n-            "integrity": "sha512-dhrUOrq2hZwr75OOIEXskUwOI9+EOkYc7BE+DlPvNuku2nuICjppK4nJc9O5Dv4N1+SEHmrYFCaZ/tAiCWWfFQ==",\n+            "version": "12.0.0",\n+            "resolved": "https://registry.npmjs.org/htmlparser2/-/htmlparser2-12.0.0.tgz",\n+            "integrity": "sha512-Tz7u1i95/g2x2jz81+x0FBVhBhY5aRTvD3tXXdFaljuNdzDLJ8UGNRrTcj2cgQvAg3iW/h77Fz15nLW0L0CrZw==",\n             "dev": true,\n             "funding": [\n                 "https://github.com/fb55/htmlparser2?sponsor=1",\n@@ -2423,7 +2423,7 @@\n             "dependencies": {\n                 "domelementtype": "^3.0.0",\n                 "domhandler": "^6.0.0",\n-                "domutils": "^4.0.0",\n+                "domutils": "^4.0.2",\n                 "entities": "^8.0.0"\n             },\n             "engines": {\ndiff --git a/package.json b/package.json\nindex 76582f8..3603a13 100644\n--- a/package.json\n+++ b/package.json\n@@ -58,7 +58,7 @@\n         "@types/node": "^25.5.0",\n         "eslint": "^10.0.3",\n         "eslint-config-biome": "^2.1.3",\n-        "htmlparser2": "~11.0.0",\n+        "htmlparser2": "^12.0.0",\n         "typedoc": "^0.28.19",\n         "typescript": "^6.0.2",\n         "typescript-eslint": "^8.62.0",\n',
};

export const wrongPatches = {
  ...Object.fromEntries(
    Object.values(developmentTasks)
      .flat()
      .map((task) => [task.id, earlierWrongPatches[task.id.replace(/-dev(?:-plan)?$/, "")]]),
  ),
  ...Object.fromEntries(
    repetitions.flatMap((suffix) =>
      tasks.map((task) => [`${task.id}${suffix}`, freshWrongPatches[task.id]]),
    ),
  ),
};
