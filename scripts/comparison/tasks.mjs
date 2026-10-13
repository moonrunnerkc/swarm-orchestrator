/**
 * The exploratory comparison's task set: issue-sized changes mined from five public repositories
 * that appear nowhere in this repository's campaign corpus, pull-request pools or earlier
 * evidence. Each task is a historical upstream change: the base is the parent of the upstream
 * commit, the hidden oracle is the upstream commit's own test files (and, for a refactor, a
 * structural check; for an upgrade, the installed version), and the visible check is one weaker
 * assertion both arms are shown. Task text was written from the upstream change without naming
 * it; the upstream commit is sealed from both arms, which work on a shallow clone of the base.
 *
 * This set is separate from the registered campaign of 2026-09-29 and shares none of its goals.
 */

const npmCi = ["npm", "ci", "--ignore-scripts"];

/** marked: tests import the built lib/marked.esm.js, so a build precedes every check. */
const markedBuild = "npm run build:esbuild";
const marked = {
  repository: "markedjs/marked",
  install: [npmCi],
  build: [["npm", "run", "build:esbuild"]],
  projectTest: ["npm", "test"],
  visiblePrefix: `${markedBuild} && `,
};

const fxp = {
  repository: "NaturalIntelligence/fast-xml-parser",
  install: [npmCi],
  build: [],
  projectTest: ["npm", "test"],
  visiblePrefix: "",
};

const yargsParser = {
  repository: "yargs/yargs-parser",
  install: [npmCi, ["npx", "tsc", "-p", "tsconfig.test.json"]],
  build: [["npx", "tsc", "-p", "tsconfig.test.json"]],
  projectTest: ["npm", "test"],
  visiblePrefix: "npx tsc -p tsconfig.test.json && ",
};

const jsYaml = {
  repository: "nodeca/js-yaml",
  install: [npmCi, ["node", "support/get-yaml-test-suite.mjs"], ["npm", "run", "build"]],
  build: [["npm", "run", "build"]],
  projectTest: ["node", "--test", "test/core/**/*.test.mjs", "test/spec/*.test.mjs"],
  visiblePrefix: "npm run build && ",
};

const minimatch = {
  repository: "isaacs/minimatch",
  install: [npmCi],
  build: [],
  projectTest: ["npm", "test"],
  visiblePrefix: "",
};

const check = (repo, source) => ({
  path: "acceptance/visible/check.mjs",
  command: `${repo.visiblePrefix}node acceptance/visible/check.mjs`,
  source,
});

export const tasks = [
  {
    id: "marked-bugfix-www-case",
    ...marked,
    workType: "bugfix",
    baseCommit: "e3c0d3e2",
    upstreamCommit: "626d9613",
    hidden: {
      testFiles: ["test/specs/new/autolinks.md", "test/specs/new/autolinks.html"],
      argv: [
        "node",
        "--test",
        "--test-reporter=spec",
        "--test-name-pattern=autolinks",
        "test/run-spec-tests.js",
      ],
    },
    immutable: ["test"],
    taskText: `With GFM autolinking enabled, marked currently turns any text starting with "www." into a link regardless of letter case, so "Www.example.com" and "WWW.example.com" become links. Per the GFM spec a bare www autolink must start with lowercase "www." exactly; mixed- or upper-case variants must stay plain text. Scheme autolinks must remain case-insensitive for the scheme, so "(See hTtPS://example.com/fhqwhgads.)" must still produce a link with the trailing period excluded. Make "www." detection case-sensitive without changing how http://, https:// or ftp:// are detected, and keep email autolinks working. Source lives under src/ (TypeScript); the library is built with npm run build:esbuild before tests run.`,
    visible: check(
      marked,
      `import assert from 'node:assert/strict';
import { marked } from '../../lib/marked.esm.js';
const upper = marked.parse('Www.example.com', { gfm: true });
assert.ok(!upper.includes('<a '), 'Www.example.com must stay plain text');
const lower = marked.parse('www.example.com', { gfm: true });
assert.ok(lower.includes('<a href="http://www.example.com"'), 'www.example.com must link');
console.log('visible check passed');
`,
    ),
  },
  {
    id: "marked-feature-def-token",
    ...marked,
    workType: "feature",
    baseCommit: "5f4b638e",
    upstreamCommit: "07691248",
    hidden: {
      testFiles: ["test/unit/Lexer.test.js"],
      argv: ["node", "--test", "--test-reporter=spec", "test/unit/Lexer.test.js"],
    },
    immutable: ["test"],
    taskText: `Link reference definitions such as '[link]: https://example.com "title"' are consumed by the lexer and recorded in lexer.links, but they do not appear in the token array returned by marked.lexer(), so walkTokens and token-based extensions cannot see them. Expose each definition as a block token of type "def" with fields raw, tag (the normalized label), href and title (undefined when absent), placed at its position in the token stream. Rendered output must not change: the parser must render nothing for the new token by default, through a new overridable renderer method def(token) so custom renderers can emit something for definitions. Every existing spec example must still pass. Source lives under src/ (TypeScript); the library is built with npm run build:esbuild before tests run.`,
    visible: check(
      marked,
      `import assert from 'node:assert/strict';
import { marked } from '../../lib/marked.esm.js';
const tokens = marked.lexer('[a]: http://x "t"\\n\\n[a]');
const def = tokens.find((token) => token.type === 'def');
assert.ok(def, 'a def token must appear in the token stream');
assert.equal(def.tag, 'a');
assert.equal(def.href, 'http://x');
assert.equal(def.title, 't');
assert.equal(marked.parse('[a]: http://x\\n\\n[a]'), '<p><a href="http://x">a</a></p>\\n');
console.log('visible check passed');
`,
    ),
  },
  {
    id: "marked-refactor-strict-exec",
    ...marked,
    workType: "refactor",
    baseCommit: "e6b37f24",
    upstreamCommit: "3b59e81a",
    hidden: {
      testFiles: [],
      argv: ["npm", "test"],
      structural: [
        {
          pattern: "\\.exec\\([^)]*\\)\\) != null",
          files: ["src/Lexer.ts", "src/Tokenizer.ts"],
          count: 0,
        },
        {
          pattern: "\\.exec\\([^)]*\\)\\) !== null",
          files: ["src/Lexer.ts", "src/Tokenizer.ts"],
          count: 5,
        },
      ],
    },
    immutable: ["test"],
    taskText: `Five while-loops in src/Lexer.ts and src/Tokenizer.ts test the result of RegExp.prototype.exec with loose inequality (\`!= null\`). RegExp.exec returns an array or null, never undefined, so replace every such loose comparison in those two files with strict \`!== null\`, and change nothing else: no other logic, no output. Every existing test must still pass (npm test).`,
    visible: check(
      marked,
      `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sources = ['src/Lexer.ts', 'src/Tokenizer.ts'].map((path) => readFileSync(path, 'utf8')).join('\\n');
assert.equal((sources.match(/\\.exec\\([^)]*\\)\\) != null/g) ?? []).length, 0, 'loose exec comparisons remain');
console.log('visible check passed');
`,
    ),
  },
  {
    id: "marked-upgrade-cheerio",
    ...marked,
    workType: "upgrade",
    baseCommit: "163c0629",
    upstreamCommit: "05d54699",
    hidden: {
      testFiles: [],
      argv: ["npm", "test"],
      upgrade: [{ name: "cheerio", section: "devDependencies", version: "1.2.0" }],
    },
    immutable: ["test"],
    taskText: `Upgrade the devDependency cheerio from the pinned version 1.1.2 to exactly 1.2.0 in package.json (declare "1.2.0", no range), regenerate package-lock.json with npm so that npm ci installs 1.2.0, and confirm npm test still passes. Change no other dependency and nothing else in package.json.`,
    visible: check(
      marked,
      `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
assert.ok(['1.2.0', '^1.2.0'].includes(manifest.devDependencies.cheerio), manifest.devDependencies.cheerio);
console.log('visible check passed');
`,
    ),
  },
  {
    id: "fxp-bugfix-uint8array-utf8",
    ...fxp,
    workType: "bugfix",
    baseCommit: "3617550a",
    upstreamCommit: "bb2ec6ce",
    hidden: {
      testFiles: ["spec/inputType_spec.js"],
      argv: ["npx", "jasmine", "spec/inputType_spec.js"],
    },
    immutable: ["spec"],
    taskText: `XMLParser.parse() accepts non-string input that has a toString method, but when a plain Uint8Array (for example the output of TextEncoder.encode) is passed, the parser stringifies it as a comma-separated list of byte values instead of decoding the bytes, so parsing fails or produces garbage. Make parse() treat a Uint8Array as UTF-8 encoded XML text: multi-byte characters (accented letters, emoji) must round-trip correctly; only the bytes inside the given view must be decoded (respect byteOffset and length of a subarray); a leading UTF-8 byte order mark must be preserved in the decoded string so that captureMetaData startIndex values match those obtained when the equivalent string is parsed directly; validation (validator.validate) must accept the same bytes it would accept as a string and reject malformed XML. Node.js Buffer input must keep working exactly as before. Source is under src/; tests run with npm test (jasmine).`,
    visible: check(
      fxp,
      `import assert from "node:assert/strict";
import { XMLParser } from "../../src/fxp.js";
const parsed = new XMLParser().parse(new TextEncoder().encode("<a>caf\\u00e9 \\u{1F600}</a>"));
assert.equal(parsed.a, "caf\\u00e9 \\u{1F600}");
console.log("visible check passed");
`,
    ),
  },
  {
    id: "fxp-feature-strict-reserved-names",
    ...fxp,
    workType: "feature",
    baseCommit: "c692040f",
    upstreamCommit: "c3ffbab9",
    hidden: { testFiles: ["spec/nfr_spec.js"], argv: ["npx", "jasmine", "spec/nfr_spec.js"] },
    immutable: ["spec"],
    taskText: `An XML element whose tag name equals the configured commentPropName or cdataPropName collides with the synthetic property the parser uses for comments or CDATA in the output object, which can let untrusted input masquerade as parser-generated structure. Add a parser option strictReservedNames (boolean, default true, documented in the TypeScript option type in src/fxp.d.ts). When it is true, encountering an opening tag whose name (after updateTag) equals commentPropName or cdataPropName must throw an Error with the message exactly "Invalid tag name: <name>". When it is explicitly set to false, such tags must be parsed as ordinary elements, producing the same output as before this option existed. Source is under src/; tests run with npm test (jasmine).`,
    visible: check(
      fxp,
      `import assert from "node:assert/strict";
import { XMLParser } from "../../src/fxp.js";
assert.throws(
  () => new XMLParser({ commentPropName: "__comment" }).parse("<r><__comment>x</__comment></r>"),
  /Invalid tag name: __comment/,
);
const relaxed = new XMLParser({ commentPropName: "__comment", strictReservedNames: false }).parse("<r><__comment>x</__comment></r>");
assert.equal(relaxed.r.__comment, "x");
console.log("visible check passed");
`,
    ),
  },
  {
    id: "fxp-refactor-unpaired-set",
    ...fxp,
    workType: "refactor",
    baseCommit: "217c46a1",
    upstreamCommit: "4c8651f8",
    hidden: {
      testFiles: [],
      argv: ["npm", "test"],
      structural: [
        {
          pattern: "options\\.unpairedTags\\.indexOf",
          files: ["src/xmlparser/OrderedObjParser.js"],
          count: 0,
        },
        {
          pattern: "unpairedTagsSet\\.has\\(",
          files: ["src/xmlparser/OrderedObjParser.js"],
          count: 5,
        },
        {
          pattern: "unpairedTagsSet = new Set\\(",
          files: ["src/xmlparser/OptionsBuilder.js"],
          count: 1,
        },
      ],
    },
    immutable: ["spec"],
    taskText: `The parser checks whether a tag is one of the configured unpairedTags in five places in src/xmlparser/OrderedObjParser.js, each time with a linear Array.prototype.indexOf scan over this.options.unpairedTags. Replace these with constant-time membership tests: build a Set from the unpairedTags array exactly once when options are normalized in buildOptions (src/xmlparser/OptionsBuilder.js), expose it on the built options as unpairedTagsSet (assigned with \`unpairedTagsSet = new Set(...)\`), and use unpairedTagsSet.has(...) at every former indexOf site so that no indexOf call on options.unpairedTags remains in the parser. Behavior must be unchanged: the original unpairedTags array stays available on the options object and the whole existing suite (npm test) passes.`,
    visible: check(
      fxp,
      `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { XMLParser } from "../../src/fxp.js";
const parser = readFileSync("src/xmlparser/OrderedObjParser.js", "utf8");
assert.equal((parser.match(/options\\.unpairedTags\\.indexOf/g) ?? []).length, 0, "indexOf scans remain");
const parsed = new XMLParser({ unpairedTags: ["br"] }).parse("<p>a<br>b</p>");
assert.ok(parsed.p !== undefined);
console.log("visible check passed");
`,
    ),
  },
  {
    id: "fxp-upgrade-strnum",
    ...fxp,
    workType: "upgrade",
    baseCommit: "8d71292a",
    upstreamCommit: "9c1905ed",
    hidden: {
      testFiles: [],
      argv: ["npm", "test"],
      upgrade: [{ name: "strnum", section: "dependencies", version: "2.4.1" }],
    },
    immutable: ["spec"],
    taskText: `Upgrade the runtime dependency strnum from the currently locked 2.4.0 to exactly 2.4.1: declare "2.4.1" in package.json (no range) and regenerate package-lock.json with npm so that node_modules/strnum resolves to exactly 2.4.1 after npm ci. Then npm ci --ignore-scripts and npm test must pass. Do not change any other dependency and do not modify source files.`,
    visible: check(
      fxp,
      `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
assert.ok(["2.4.1", "^2.4.1"].includes(manifest.dependencies.strnum), manifest.dependencies.strnum);
console.log("visible check passed");
`,
    ),
  },
  {
    id: "yargs-parser-bugfix-count-sentinel",
    ...yargsParser,
    workType: "bugfix",
    baseCommit: "b82ba0f9",
    upstreamCommit: "add38aaf",
    hidden: {
      testFiles: ["test/yargs-parser.mjs"],
      argv: ["npx", "mocha", "test/yargs-parser.mjs"],
    },
    immutable: ["test"],
    taskText: `When an option that is NOT declared as a count is repeated with numeric values and one of those values is 1, the parser silently adds them up instead of collecting them: parser("-x 3 -x 1") returns { x: 4 } while parser("-x 3 -x 2") correctly returns { x: [3, 2] }. Repeated values must always be collected into an array ("-x 3 -x 1" gives [3, 1], "-x 1 -x 1" gives [1, 1], "-x 1 -x 3" gives [1, 3]) whatever the numbers, and options that ARE declared under count must keep incrementing exactly as before ("-v -v -v" with count: ["v"] gives 3). Nothing else about duplicate-argument handling may change. Source is lib/yargs-parser.ts; tests are compiled with npx tsc -p tsconfig.test.json and run with npm test (mocha); test/yargs-parser.mjs imports the built library.`,
    visible: check(
      yargsParser,
      `import assert from "node:assert/strict";
import parser from "../../build/lib/index.js";
assert.deepEqual(parser("-x 3 -x 1"), { _: [], x: [3, 1] });
assert.deepEqual(parser("-v -v -v", { count: ["v"] }), { _: [], v: 3 });
console.log("visible check passed");
`,
    ),
  },
  {
    id: "yargs-parser-bugfix-negation-unknown",
    ...yargsParser,
    workType: "bugfix",
    baseCommit: "c58adb0a",
    upstreamCommit: "b82ba0f9",
    hidden: {
      testFiles: ["test/yargs-parser.mjs"],
      argv: ["npx", "mocha", "test/yargs-parser.mjs"],
    },
    immutable: ["test"],
    taskText: `With the configuration unknown-options-as-args: true, arguments that are not recognised options are placed into the positional array _ instead of being parsed as flags. When boolean-negation is additionally set to false, the --no-<name> negation syntax is disabled, so --no-known-arg can no longer refer to the declared boolean known-arg and must be treated as an unknown option. Today it is still recognised and produces knownArg: false. Required: parser("--no-known-arg --no-unknown-arg", { boolean: ["known-arg"], configuration: { "unknown-options-as-args": true, "boolean-negation": false } }) must return exactly { _: ["--no-known-arg", "--no-unknown-arg"] }. With boolean-negation left at its default, behavior must not change (--no-known-arg still yields knownArg: false). Source is lib/yargs-parser.ts; tests are compiled with npx tsc -p tsconfig.test.json and run with npm test (mocha).`,
    visible: check(
      yargsParser,
      `import assert from "node:assert/strict";
import parser from "../../build/lib/index.js";
assert.deepEqual(
  parser("--no-known-arg --no-unknown-arg", {
    boolean: ["known-arg"],
    configuration: { "unknown-options-as-args": true, "boolean-negation": false },
  }),
  { _: ["--no-known-arg", "--no-unknown-arg"] },
);
console.log("visible check passed");
`,
    ),
  },
  {
    id: "yargs-parser-upgrade-toolchain",
    ...yargsParser,
    install: [npmCi],
    workType: "upgrade",
    baseCommit: "9866eca5",
    upstreamCommit: "913df9d1",
    hidden: {
      testFiles: [],
      argv: ["npm", "test"],
      extraArgv: [["npm", "run", "check"]],
      upgrade: [
        { name: "mocha", section: "devDependencies", version: "12.0.0" },
        { name: "chai", section: "devDependencies", version: "6.2.2" },
        { name: "c8", section: "devDependencies", version: "12.0.0" },
        { name: "gts", section: "devDependencies", version: "6.0.2" },
      ],
    },
    upgradeSourcePaths: [".eslintrc.json", ".eslintignore"],
    immutable: ["test"],
    taskText: `Upgrade the test and lint toolchain devDependencies to these exact versions, declared without ranges in package.json: mocha 12.0.0, chai 6.2.2, c8 12.0.0 and gts 6.0.2, and regenerate package-lock.json with npm so npm ci --ignore-scripts installs exactly those. Afterwards npm test must pass on Node 24 and npm run check (gts lint) must still pass; gts 6 needs the ESLint configuration adjusted (a parserOptions.project for the TypeScript override and the Deno files excluded from linting), so .eslintrc.json and .eslintignore may change. Do not change library source or tests, and change no other dependency.`,
    visible: check(
      yargsParser,
      `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
for (const [name, version] of [["mocha", "12.0.0"], ["chai", "6.2.2"], ["c8", "12.0.0"], ["gts", "6.0.2"]])
  assert.ok([version, \`^\${version}\`].includes(manifest.devDependencies[name]), \`\${name}: \${manifest.devDependencies[name]}\`);
console.log("visible check passed");
`,
    ),
  },
  {
    id: "js-yaml-bugfix-timestamp-early-years",
    ...jsYaml,
    workType: "bugfix",
    baseCommit: "355dc969",
    upstreamCommit: "49280f3e",
    hidden: {
      testFiles: ["test/core/tags/timestamp.test.mjs"],
      argv: ["node", "--test", "test/core/tags/timestamp.test.mjs"],
    },
    immutable: ["test"],
    taskText: `With the YAML 1.1 schema (YAML11_SCHEMA), timestamps whose year is between 0000 and 0099 are not recognized: load("- 0001-01-01\\n- 0050-06-15T12:30:00Z", { schema: YAML11_SCHEMA }) returns plain strings instead of Date objects, and a Date in that range does not survive dump followed by load. Make such date-only and full timestamps resolve to Date values whose UTC year is the literal four-digit year written in the document (year 1, year 50), with calendar validation still rejecting dates that Date would normalize such as 0001-02-29 (which must stay a string, and must raise "cannot resolve" when tagged !!timestamp explicitly). Behavior for years 0100 and later must not change. Source is under src/ (TypeScript); the package is built with npm run build and tests run with node --test "test/core/**/*.test.mjs" "test/spec/*.test.mjs".`,
    visible: check(
      jsYaml,
      `import assert from 'node:assert/strict'
import { load, YAML11_SCHEMA } from 'js-yaml'
const date = load('0050-06-15T12:30:00Z', { schema: YAML11_SCHEMA })
assert.ok(date instanceof Date, 'year 0050 must resolve to a Date')
assert.equal(date.getUTCFullYear(), 50)
console.log('visible check passed')
`,
    ),
  },
  {
    id: "js-yaml-feature-max-aliases",
    ...jsYaml,
    workType: "feature",
    baseCommit: "3105455b",
    upstreamCommit: "125cd5ab",
    hidden: {
      testFiles: ["test/core/units/load-options.test.mjs"],
      argv: ["node", "--test", "test/core/units/load-options.test.mjs"],
    },
    immutable: ["test"],
    taskText: `Add a maxAliases loader option to load() and loadAll(), documented in README next to the other load options, that limits how many alias nodes (*ref) a single document may contain. The default -1 means no limit; 0 rejects any alias; a positive N allows at most N alias uses per document. Exceeding the limit must throw the library's YAMLException with a message containing "maxAliases" (for example "aliases exceeded maxAliases (1)"). The count resets for every document in a multi-document stream, so loadAll on two documents with one alias each succeeds with maxAliases: 1 and fails with maxAliases: 0. Documents without aliases are unaffected whatever the option. Source is under src/ (TypeScript); the package is built with npm run build and tests run with node --test "test/core/**/*.test.mjs" "test/spec/*.test.mjs".`,
    visible: check(
      jsYaml,
      `import assert from 'node:assert/strict'
import { load } from 'js-yaml'
assert.throws(() => load('a: &x 1\\nb: *x\\nc: *x', { maxAliases: 1 }), /maxAliases/)
assert.deepEqual(load('a: &x 1\\nb: *x\\nc: *x', { maxAliases: 2 }), { a: 1, b: 1, c: 1 })
console.log('visible check passed')
`,
    ),
  },
  {
    id: "js-yaml-refactor-is-plain-object",
    ...jsYaml,
    workType: "refactor",
    baseCommit: "0429ae6b",
    upstreamCommit: "d482b163",
    hidden: {
      testFiles: ["test/core/common/object.test.mjs"],
      argv: ["node", "--test", "test/core/common/object.test.mjs", "test/core/tags/*.test.mjs"],
      structural: [
        { pattern: "function isPlainObject", files: ["src/common/object.ts"], count: 1 },
        { pattern: "function isPlainObject", files: ["src/tag/mapping/map.ts"], count: 0 },
        { pattern: "common/object", files: ["src/tag/mapping/map.ts"], count: 1 },
        { pattern: "common/object", files: ["src/tag/mapping/real_map.ts"], count: 1 },
      ],
    },
    immutable: ["test/spec", "test/core/tags", "test/core/units"],
    taskText: `The helper isPlainObject (true only for a non-null, non-array object whose prototype is null or Object.prototype) is defined inside src/tag/mapping/map.ts and re-exported from there for src/tag/mapping/real_map.ts, although it is a general-purpose utility. Move it into a new module src/common/object.ts as a named export isPlainObject with the same signature (data: unknown) => boolean and identical semantics; import it from "../../common/object.ts" in both mapping tag modules; remove the definition and its export from map.ts. Public behavior, the full test suite, lint and type-check must be unchanged. Source is under src/ (TypeScript); the package is built with npm run build and tests run with node --test "test/core/**/*.test.mjs" "test/spec/*.test.mjs".`,
    visible: check(
      jsYaml,
      `import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPlainObject } from '../../src/common/object.ts'
assert.equal(isPlainObject({}), true)
assert.equal(isPlainObject([]), false)
assert.equal(isPlainObject(null), false)
assert.equal((readFileSync('src/tag/mapping/map.ts', 'utf8').match(/function isPlainObject/g) ?? []).length, 0)
console.log('visible check passed')
`,
    ),
  },
  {
    id: "js-yaml-upgrade-vite-workerpool",
    ...jsYaml,
    workType: "upgrade",
    baseCommit: "39f3211a",
    upstreamCommit: "4a864e55",
    hidden: {
      testFiles: [],
      argv: ["node", "--test", "test/core/**/*.test.mjs", "test/spec/*.test.mjs"],
      upgrade: [
        { name: "vite", section: "devDependencies", version: "8.1.2" },
        { name: "workerpool", section: "devDependencies", version: "10.0.3" },
      ],
    },
    immutable: ["test"],
    taskText: `Update two devDependencies to exact versions declared without ranges in package.json: vite to 8.1.2 and workerpool to 10.0.3. Regenerate package-lock.json with npm so that npm ci --ignore-scripts installs exactly those versions, and confirm the build (npm run build, which uses vite) and the full node:test suite still pass. No other dependency may change and nothing else in package.json may change.`,
    visible: check(
      jsYaml,
      `import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
assert.ok(['8.1.2', '^8.1.2'].includes(manifest.devDependencies.vite), manifest.devDependencies.vite)
assert.ok(['10.0.3', '^10.0.3'].includes(manifest.devDependencies.workerpool), manifest.devDependencies.workerpool)
console.log('visible check passed')
`,
    ),
  },
  {
    id: "js-yaml-bugfix-flow-colon-quoting",
    ...jsYaml,
    workType: "bugfix",
    baseCommit: "ac16b42c",
    upstreamCommit: "bd7ebb2b",
    hidden: {
      testFiles: ["test/core/units/dump-options.test.mjs"],
      argv: ["node", "--test", "test/core/units/dump-options.test.mjs"],
    },
    immutable: ["test"],
    taskText: `dump() emits unparseable or lossy output for strings in flow collections when a colon is immediately followed by a flow indicator. For example dump([":{"], { flowLevel: 0 }) and dump({ k: ":[" }, { flowLevel: 0 }) leave the value as a plain scalar, so load(dump(x)) does not give back x for values such as ":{", ":[", ":,", ":}", ":]" or "x:{". In flow context a colon followed by any of , [ ] { } is not plain-safe (YAML 1.2, ns-plain-safe-in excludes c-flow-indicator), so such values must be quoted when presented in flow style, while block-context output and other plain scalars (for example "a:b", or "x:{" at block level) must stay exactly as they are today. Source is under src/ (TypeScript); the package is built with npm run build and tests run with node --test "test/core/**/*.test.mjs" "test/spec/*.test.mjs".`,
    visible: check(
      jsYaml,
      `import assert from 'node:assert/strict'
import { dump, load } from 'js-yaml'
for (const value of [':{', ':[', 'x:{']) {
  assert.deepEqual(load(dump([value], { flowLevel: 0 })), [value], JSON.stringify(value))
}
assert.equal(dump({ k: 'x:{' }), 'k: x:{\\n')
console.log('visible check passed')
`,
    ),
  },
  {
    id: "fxp-feature-end-index",
    ...fxp,
    workType: "feature",
    baseCommit: "2ce7191e",
    upstreamCommit: "4652011b",
    hidden: {
      testFiles: ["spec/endIndex_spec.js", "spec/startIndex_spec.js"],
      argv: ["npx", "jasmine", "spec/endIndex_spec.js", "spec/startIndex_spec.js"],
    },
    immutable: ["spec"],
    taskText: `When the captureMetaData option is enabled, every parsed element node carries a metadata object (under the symbol returned by XMLParser.getMetaDataSymbol()) that currently holds only startIndex, the offset of the node's opening "<". Add endIndex to that same metadata object: the exclusive offset just past the last character of the node in the input string, so that input.slice(startIndex, endIndex) is the node's full source text. It must be set for paired elements (the position after the closing tag's ">"), self-closing elements (after "/>"), unpaired tags configured through unpairedTags, and processing-instruction nodes (after "?>"); nested elements each get their own value; it must work in both the default and the preserveOrder output, and the updateTag option must not disturb a sibling's indices. Declare the field in the TypeScript types in src/fxp.d.ts. Source is under src/; tests run with npm test (jasmine).`,
    visible: check(
      fxp,
      `import assert from "node:assert/strict";
import { XMLParser } from "../../src/fxp.js";
const xml = '<root><a x="1">t</a><b/></root>';
const parser = new XMLParser({ captureMetaData: true, ignoreAttributes: false });
const meta = XMLParser.getMetaDataSymbol();
const parsed = parser.parse(xml);
const a = parsed.root.a[meta];
assert.equal(xml.slice(a.startIndex, a.endIndex), '<a x="1">t</a>');
console.log("visible check passed");
`,
    ),
  },
  {
    id: "minimatch-bugfix-partial-globstar",
    ...minimatch,
    install: [npmCi, ["npx", "tshy"]],
    build: [["npx", "tshy"]],
    visiblePrefix: "npx tshy && ",
    workType: "bugfix",
    baseCommit: "ea948403",
    upstreamCommit: "3a0d83b6",
    hidden: {
      testFiles: ["test/partial.ts"],
      argv: ["npx", "tap", "run", "--disable-coverage", "test/partial.ts"],
    },
    immutable: ["test"],
    taskText: `With the partial: true option (and Minimatch#match(path, true)), a path should match when it is a valid prefix of a path that the full pattern could match, including when the pattern contains **. Today patterns with a globstar wrongly report false for valid prefixes. For example minimatch("/b/c/d/a", "/**/a/b/c", { partial: true }), minimatch("/b/c/d/a", "/**/a/b/c/**", { partial: true }), minimatch("a", "a/**", { partial: true }), minimatch("/b/c/d/a", "/**/a/**/b/c/**", { partial: true }) and minimatch("/b/c/d/a", "/**/a/**", { partial: true }) must all return true, while minimatch("b/a", "a/**", { partial: true }) must still return false. Existing partial behavior for patterns without ** (for example "/a/b" against "/*/b/x/y/z" is true and "/a/b/c" is false) and makeRe(pattern, { partial: true }) must be unchanged, and non-partial matching must not loosen: minimatch("/b/c/d/a", "/**/a/b/c") stays false. Make the change in the ** path-walking logic in src/index.ts, not by post-processing results. The library is TypeScript built with npx tshy; tests run with npm test (tap, which requires 100% coverage).`,
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "npx tshy && node acceptance/visible/check.mjs",
      source: `import assert from "node:assert/strict";
import { minimatch } from "../../dist/esm/index.js";
assert.equal(minimatch("/b/c/d/a", "/**/a/b/c", { partial: true }), true);
assert.equal(minimatch("b/a", "a/**", { partial: true }), false);
assert.equal(minimatch("/b/c/d/a", "/**/a/b/c"), false);
console.log("visible check passed");
`,
    },
  },
  {
    id: "minimatch-bugfix-drive-letter",
    ...minimatch,
    install: [npmCi, ["npx", "tshy"]],
    build: [["npx", "tshy"]],
    visiblePrefix: "npx tshy && ",
    workType: "bugfix",
    baseCommit: "1caf9189",
    upstreamCommit: "7953af1f",
    hidden: {
      testFiles: ["test/optimization-level-2.ts"],
      argv: ["npx", "tap", "run", "--disable-coverage", "test/optimization-level-2.ts"],
    },
    immutable: ["test"],
    taskText: `When matching on Windows (platform: "win32") at optimizationLevel 2, the path optimizer that collapses "<dir>/.." segments must treat a drive-letter root such as "C:" as a root rather than an ordinary directory, so ".." cannot step past it. Today new Minimatch("public/**", { platform: "win32", optimizationLevel: 2 }).match("C:/../public/secret") returns true, because the optimizer rewrites "C:/../public/secret" into "public/secret"; it must return false, as it already does at optimizationLevel 1. On non-Windows platforms a leading "C:" is not special, so new Minimatch("public/**", { platform: "darwin", optimizationLevel: 2 }).match("C:/../public/secret") must remain true. Only the ..-collapsing step may change; "**/.." and "./" handling stay as they are. Source is src/index.ts (TypeScript built with npx tshy); tests run with npm test (tap, which requires 100% coverage).`,
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "npx tshy && node acceptance/visible/check.mjs",
      source: `import assert from "node:assert/strict";
import { Minimatch } from "../../dist/esm/index.js";
assert.equal(new Minimatch("public/**", { platform: "win32", optimizationLevel: 2 }).match("C:/../public/secret"), false);
assert.equal(new Minimatch("public/**", { platform: "darwin", optimizationLevel: 2 }).match("C:/../public/secret"), true);
console.log("visible check passed");
`,
    },
  },
  {
    id: "minimatch-upgrade-tap-types-node",
    ...minimatch,
    install: [npmCi, ["npx", "tshy"]],
    build: [["npx", "tshy"]],
    visiblePrefix: "",
    workType: "upgrade",
    baseCommit: "b9d01537",
    upstreamCommit: "fa2133b3",
    hidden: {
      testFiles: [],
      argv: ["npm", "test"],
      upgrade: [
        { name: "@types/node", section: "devDependencies", version: "25.3.0" },
        { name: "tap", section: "devDependencies", version: "21.6.1" },
      ],
    },
    immutable: ["test", "src"],
    taskText: `Upgrade two devDependencies to exact versions declared without ranges in package.json: @types/node to 25.3.0 and tap to 21.6.1, regenerating package-lock.json with npm so that npm ci --ignore-scripts installs exactly those versions and no other dependency section changes. After the upgrade, npm test (the tshy build followed by tap with its default 100% coverage requirement) must pass on Node 24; at present the suite hangs on this Node version until tap's timeout. Do not change any source or test file.`,
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source: `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
assert.ok(["25.3.0", "^25.3.0"].includes(manifest.devDependencies["@types/node"]), manifest.devDependencies["@types/node"]);
assert.ok(["21.6.1", "^21.6.1"].includes(manifest.devDependencies.tap), manifest.devDependencies.tap);
console.log("visible check passed");
`,
    },
  },
];
