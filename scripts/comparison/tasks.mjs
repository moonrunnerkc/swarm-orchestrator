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

import { readFileSync } from "node:fs";

const npmCi = ["npm", "ci", "--ignore-scripts"];

/**
 * The accessor task's hidden API check, kept with the audit that established the requirement and
 * written into the scoring checkout under acceptance/hidden/, so its imports step up two
 * directories to the project's source.
 */
const sinonAccessorApiCheck = readFileSync(
  new URL("../../docs/evidence/2026-10-21/accessor-audit/api-check.mjs", import.meta.url),
  "utf8",
).replaceAll('from "./src/', 'from "../../src/');

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

/**
 * Fresh tasks of 2026-10-21, mined from two repositories that appear nowhere in this
 * repository's campaign corpus, pull-request pools, mirrors or earlier evidence (motdotla/dotenv
 * and sinonjs/sinon), each a bug-fix commit that changed source and tests, validated with no
 * model: the base fails the commit's own test file and passes the project's node tests, the
 * commit passes both. Task text was written from the base's observed behaviour and the upstream
 * change without naming it.
 */
const dotenv = {
  repository: "motdotla/dotenv",
  install: [npmCi],
  build: [],
  projectTest: ["npm", "test"],
  visiblePrefix: "",
};

const sinon = {
  repository: "sinonjs/sinon",
  install: [npmCi],
  build: [],
  // The project's `npm test` also drives two browser suites, which this harness does not
  // provision; the node suite is the project's own `test-node` script (mocha over test/).
  projectTest: ["npm", "run", "test-node"],
  visiblePrefix: "",
};

/**
 * Fresh tasks for the comparison after the task-continuation trial, from mochajs/mocha, a
 * repository this project has never launched or registered a task from: the first two entries of
 * docs/evidence/2026-10-21/delivery-trial/candidates.json, re-validated on this host with no
 * model (docs/evidence/2026-10-21/fresh-comparison/). Task text was written from the base's
 * observed behaviour and the upstream change without naming it.
 */
/**
 * The mocha tasks' hidden behaviour checks: every example their task text states, beyond the
 * upstream test files, kept with the stage that registered them and written into the scoring
 * checkout under acceptance/hidden/, so their imports step up two directories to the source.
 */
const mochaBehaviourCheck = (name) =>
  readFileSync(
    new URL(`../../docs/evidence/2026-10-21/fresh-comparison/hidden/${name}`, import.meta.url),
    "utf8",
  );

const mocha = {
  repository: "mochajs/mocha",
  install: [npmCi],
  build: [],
  // The project's `npm test` runs lint, every node suite and a Playwright browser suite, which
  // this harness does not provision; the unit suites are its own `test-node:unit` script
  // (mocha under nyc over test/unit and test/node-unit).
  projectTest: ["npm", "run", "test-node:unit"],
  visiblePrefix: "",
};

/**
 * Fresh tasks of 2026-10-22, selected by docs/evidence/2026-10-22/fresh-tasks/selection-rule.md
 * from two repositories no launch of this project has used, validated with no model
 * (docs/evidence/2026-10-22/fresh-tasks/). Task text was written from the base's observed behaviour
 * and the upstream change without naming it. Their hidden behaviour checks are kept with that stage.
 */
const freshBehaviourCheck = (name) =>
  readFileSync(
    new URL(`../../docs/evidence/2026-10-22/fresh-tasks/hidden/${name}`, import.meta.url),
    "utf8",
  );

const acorn = {
  repository: "acornjs/acorn",
  install: [npmCi],
  build: [],
  // `npm test` builds the parser from source (its pretest) and runs every test file.
  projectTest: ["npm", "test"],
  visiblePrefix: "",
};

const entities = {
  repository: "fb55/entities",
  install: [npmCi],
  build: [],
  // The project's `npm test` also runs eslint, tsc and biome; its test suite alone is `test:vi`.
  projectTest: ["npm", "run", "test:vi"],
  visiblePrefix: "",
};

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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: [],
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
    immutable: ["src"],
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
  {
    id: "dotenv-bugfix-fast-parser-line-ends",
    ...dotenv,
    workType: "bugfix",
    baseCommit: "e73dc1f51",
    upstreamCommit: "048dd4863",
    hidden: {
      testFiles: ["tests/test-parse-fast.js"],
      argv: ["npx", "tap", "run", "--disable-coverage", "tests/test-parse-fast.js"],
    },
    immutable: [],
    taskText: `dotenv's opt-in fast parser, dotenv.parse(src, { fast: true }) (the hand-written scanner parseFast in lib/main.js), must give the same result as the classic parser dotenv.parse(src) in three situations where it diverges today. (1) A colon separator followed by a line break: for 'A:\\nfoo' the classic parser gives { A: 'foo' } and the fast parser gives { A: '' }; 'A:\\r\\nfoo\\nNEXT=ok' must give { A: 'foo', NEXT: 'ok' }. (2) The word export used as a key: 'export =value' and 'export\\t=value' must give { export: 'value' } (the fast parser gives {} today), while 'export : value\\nNEXT=ok' must still give { NEXT: 'ok' } and 'export KEY=value' must still give { KEY: 'value' }. (3) The Unicode line separators U+2028 and U+2029 must end a comment, a quoted value's line and an invalid line, as the classic parser already treats them: 'A="x"\\u2028B=ok' must give { A: 'x', B: 'ok' } (today { A: '"x"\\u2028B=ok' }), '# comment\\u2028B=ok' must give { B: 'ok' } (today {}), 'A="x" # comment\\u2028B=ok' and 'A=x # comment\\u2028B=ok' must give { A: 'x', B: 'ok' } (today { A: 'x' }), 'invalid\\u2028B=ok' must give { B: 'ok' } (today {}); an unquoted value keeps them, so 'A=x\\u2028B=ok' stays { A: 'x\\u2028B=ok' }, as both parsers give today. Make the change in the fast scanner in lib/main.js; the classic parser is the reference and must not change, and every case where the two parsers already agree must keep agreeing. The library is CommonJS; npm test builds it, runs the standard linter, checks the types and runs tap over tests/.`,
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      // In the project's own style: its npm test runs standard over the whole tree.
      source: `import assert from 'node:assert/strict'
import dotenv from '../../lib/main.js'
assert.deepEqual(dotenv.parse('A:\\nfoo', { fast: true }), { A: 'foo' })
assert.deepEqual(dotenv.parse('export =value', { fast: true }), { export: 'value' })
assert.deepEqual(dotenv.parse('# comment\\u2028B=ok', { fast: true }), { B: 'ok' })
assert.deepEqual(dotenv.parse('A=x\\u2028B=ok', { fast: true }), { A: 'x\\u2028B=ok' })
console.log('visible check passed')
`,
    },
  },
  {
    id: "sinon-bugfix-stub-accessor-calls",
    ...sinon,
    workType: "bugfix",
    baseCommit: "8c663edec",
    upstreamCommit: "002ee82bc",
    hidden: {
      testFiles: ["test/src/stub-test.js"],
      argv: ["npx", "mocha", "-R", "dot", "test/src/stub-test.js"],
    },
    immutable: [],
    taskText: `sinon.stub(obj, "prop").get(fn) and sinon.stub(obj, "prop").set(fn) install the replacement function directly as the property's accessor, so reading or writing the stubbed property runs the replacement untracked: nothing records the access and there is no call count to assert on. Wrap the replacement getter and the replacement setter in a spy and expose the spies on the stub as stub.getter and stub.setter, mirroring the spy.get and spy.set surface that sinon.spy(obj, "prop", ["get"]) produces. After const stub = sinon.stub(obj, "prop").get(() => "bar"), reading obj.prop three times must give "bar" each time and stub.getter.callCount must be 3 (stub.getter.calledThrice true); after const stub = sinon.stub(obj, "prop").set((value) => { obj.example = value }), assigning obj.prop = "bar" then obj.prop = "baz" must run the setter both times (obj.example is "baz") with stub.setter.callCount 2 and stub.setter.calledWith("bar") true. stub.resetBehavior() must remove both, so stub.getter and stub.setter are undefined afterwards. Everything .get and .set do today must stay: the replacement runs, the property is defined configurable as before, restore works, and .get and .set stay chainable. Source is ESM under src/sinon/ (default-behaviors.js holds the get and set behaviours, stub.js the stub prototype, spy.js makes spies); the node tests run with npm run test-node (mocha over test/src, test/issues and test/scripts).`,
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source: `import assert from "node:assert/strict";
import createStub from "../../src/sinon/stub.js";
const obj = { prop: "foo" };
const stub = createStub(obj, "prop").get(() => "bar");
assert.equal(obj.prop, "bar");
assert.equal(obj.prop, "bar");
assert.equal(stub.getter.callCount, 2);
process.stdout.write("visible check passed\\n");
`,
    },
  },
  {
    // The accessor task again, exposed development material after 2026-10-21: the published
    // patch counted calls but exposed wrappers without the spy surface the task named, and no
    // check asked for it. The text now says what "mirroring the spy.get and spy.set surface"
    // requires, and a hidden check (acceptance-audit/api-check.mjs, never in an arm's
    // workspace) holds the delivered tree to it beyond the task's own examples.
    id: "sinon-bugfix-stub-accessor-calls-v2",
    ...sinon,
    workType: "bugfix",
    baseCommit: "8c663edec",
    upstreamCommit: "002ee82bc",
    hidden: {
      testFiles: ["test/src/stub-test.js"],
      argv: ["npx", "mocha", "-R", "dot", "test/src/stub-test.js"],
      files: [{ path: "acceptance/hidden/api-check.mjs", source: sinonAccessorApiCheck }],
      extraArgv: [["node", "acceptance/hidden/api-check.mjs"]],
    },
    immutable: [],
    taskText: `sinon.stub(obj, "prop").get(fn) and sinon.stub(obj, "prop").set(fn) install the replacement function directly as the property's accessor, so reading or writing the stubbed property runs the replacement untracked: nothing records the access and there is no call count to assert on. Wrap the replacement getter and the replacement setter in a spy and expose the spies on the stub as stub.getter and stub.setter, mirroring the spy.get and spy.set surface that sinon.spy(obj, "prop", ["get"]) produces. That surface is the whole sinon spy API, not a call counter: stub.getter and stub.setter must be sinon spies on which everything sinon.spy(fn) returns supports works the same way, among them callCount, calledOnce and calledThrice, calledWith, withArgs, getCall and firstCall, args, returnValues and resetHistory; a wrapper that only counts calls does not meet this. After const stub = sinon.stub(obj, "prop").get(() => "bar"), reading obj.prop three times must give "bar" each time and stub.getter.callCount must be 3 (stub.getter.calledThrice true); after const stub = sinon.stub(obj, "prop").set((value) => { obj.example = value }), assigning obj.prop = "bar" then obj.prop = "baz" must run the setter both times (obj.example is "baz") with stub.setter.callCount 2, stub.setter.calledWith("bar") true and stub.setter.withArgs("bar").callCount 1. stub.resetBehavior() must remove both, so stub.getter and stub.setter are undefined afterwards. Everything .get and .set do today must stay: the replacement runs, the property is defined configurable as before, restore works, and .get and .set stay chainable. Source is ESM under src/sinon/ (default-behaviors.js holds the get and set behaviours, stub.js the stub prototype, spy.js makes spies); the node tests run with npm run test-node (mocha over test/src, test/issues and test/scripts).`,
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source: `import assert from "node:assert/strict";
import createStub from "../../src/sinon/stub.js";
const obj = { prop: "foo" };
const stub = createStub(obj, "prop").get(() => "bar");
assert.equal(obj.prop, "bar");
assert.equal(obj.prop, "bar");
assert.equal(stub.getter.callCount, 2);
process.stdout.write("visible check passed\\n");
`,
    },
  },
  {
    id: "sinon-bugfix-mock-oncall-expectations",
    ...sinon,
    workType: "bugfix",
    baseCommit: "177e318c2",
    upstreamCommit: "40de5a48c",
    hidden: {
      testFiles: ["test/src/mock-test.js"],
      argv: ["npx", "mocha", "-R", "dot", "test/src/mock-test.js"],
    },
    immutable: [],
    taskText: `A mock's expectations carry stub behaviours, including per-call ones set with onCall(n). When several expectations for one method are told apart by withArgs and each sets a behaviour for a call index with onCall, the behaviour is looked up by that expectation's own call count rather than by the call's position among all the method's calls, so the configured behaviour is not applied. With const mock = sinon.mock(object); mock.expects("accumulate").withArgs("first thing").onCall(0).callsFake((thing) => "mock-added " + thing); mock.expects("accumulate").withArgs("second thing").onCall(1).callsFake(...same...); mock.expects("accumulate").withArgs("third thing").onCall(2).callsFake(...same...), calling object.accumulate("first thing"), object.accumulate("second thing") and object.accumulate("third thing") in that order must return "mock-added first thing", "mock-added second thing" and "mock-added third thing", and mock.verify() must pass; today only the first call returns the fake's value and the second and third return undefined. Fix this so that an expectation invoked by the mock picks its behaviour by the number of calls already made to the method across all of that method's expectations (the call's position in the mock's sequence), and only while that invocation runs; do not change how the mock selects an expectation (withArgs matching, exhausted expectations, calls in any order) or how an ordinary stub picks its behaviour by its own callCount. Source is ESM under src/sinon/ (mock.js invokes expectations; stub.js chooses the current behaviour); the node tests run with npm run test-node (mocha over test/src, test/issues and test/scripts).`,
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source: `import assert from "node:assert/strict";
import sinonMock from "../../src/sinon/mock.js";
const object = { accumulate(thing) { return \`added \${thing}\`; } };
const mock = sinonMock(object);
mock.expects("accumulate").withArgs("first thing").onCall(0).callsFake((thing) => \`mock-added \${thing}\`);
mock.expects("accumulate").withArgs("second thing").onCall(1).callsFake((thing) => \`mock-added \${thing}\`);
assert.equal(object.accumulate("first thing"), "mock-added first thing");
assert.equal(object.accumulate("second thing"), "mock-added second thing");
mock.verify();
process.stdout.write("visible check passed\\n");
`,
    },
  },
  {
    id: "mocha-bugfix-long-prefix-short-alias",
    ...mocha,
    workType: "bugfix",
    baseCommit: "bb2e69a95",
    upstreamCommit: "12279398f",
    hidden: {
      testFiles: ["test/node-unit/cli/parse-args.spec.js"],
      argv: ["node", "bin/mocha.js", "test/node-unit/cli/parse-args.spec.js"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: mochaBehaviourCheck("alias-behaviour-check.mjs"),
        },
      ],
      extraArgv: [["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: `mocha's command-line parser (parseMochaArgs in lib/cli/parse-args.js) accepts each one-character option alias written with one dash, but the same alias written with two dashes, with its value given as the next argument, is not read as that option. Today parseMochaArgs(["--t", "0"], { timeout: 1000 }) throws "Mocha flag '--t' given invalid option: '0'" (so mocha --t 0 a.spec.cjs exits 1 with that error), parseMochaArgs(["--R", "dot"], { timeout: 1000 }) gives reporter true and takes "dot" as a spec file (_ is ["dot"]), and ["--r", "./x.js", "--r", "./y.js"] gives require ["true"] with both files in _. A one-character alias written with two dashes must mean exactly what it means with one dash, with the value given as the next argument or after "=". With defaults { timeout: 1000 }: ["--t", "0"] and ["--t=0"] must both give timeout "0" and _ []; ["--R", "dot"] must give reporter "dot" and _ []; ["--r", "./x.js", "--r", "./y.js"] must give require ["./x.js", "./y.js"] and _ []; ["--j", "3"] must give jobs 3; ["test/a.js", "--t", "0"] must give _ ["test/a.js"] and timeout "0"; ["--timeout", "5", "--t", "7"] must give timeout "7"; and, as with one dash, the alias itself must not appear as a key of the result (no t, R, r or j property). What must not change: one-dash aliases (["-t", "0"] gives timeout "0"; ["-R", "json", "-b"] gives reporter "json" and bail true), the "=" form that already works today (["--t=0"] gives timeout "0"), long names and long aliases (["--timeouts=200"] gives timeout "200", ["--reporter-options=a=b"] gives reporter-option ["a=b"]), negation (["--no-bail"] gives bail false), boolean one-character aliases that already work with two dashes (["--b"] gives bail true, ["--A"] gives async-only true) and unknown flags (["--x"] still gives x true). The parser is ESM in lib/cli/parse-args.js, where option names are normalised before yargs-parser reads them. Add regression tests for this behaviour to the project's existing test suite (the CLI's unit tests are under test/node-unit/cli/). The unit tests run with npm run test-node:unit (mocha under nyc over test/unit and test/node-unit).`,
    visible: check(
      mocha,
      `import assert from "node:assert/strict";
import { parseMochaArgs } from "../../lib/cli/parse-args.js";

const result = parseMochaArgs(["--t", "0"], { timeout: 1000 });
assert.equal(result.timeout, "0");
console.log("visible check passed");
`,
    ),
  },
  {
    id: "mocha-bugfix-unparse-attached-values",
    ...mocha,
    workType: "bugfix",
    baseCommit: "e5a779eb4",
    upstreamCommit: "15aa7d155",
    hidden: {
      testFiles: ["test/node-unit/cli/unparse-args.spec.js"],
      argv: ["node", "bin/mocha.js", "test/node-unit/cli/unparse-args.spec.js"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: mochaBehaviourCheck("unparse-behaviour-check.mjs"),
        },
      ],
      extraArgv: [["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: `When mocha must start a second Node process (a Node or V8 flag such as --enable-source-maps was given, or --node-option was used), bin/mocha.js turns the options it loaded back into command-line arguments with unparseMochaArgs from lib/cli/unparse-args.js and passes them to the child. Today an option with a scalar value is emitted as two arguments, the flag and then the value (unparseMochaArgs({ reporter: "json" }) gives ["--reporter", "json"]), except dotted names such as reporter-option.foo, which are emitted as one "--name=value" argument. An option the child has no definition for is then read as a boolean flag and its value as a test file: in a directory whose .mocharc.json holds "$schema": "https://json.schemastore.org/mocharc.json" and "spec": "a.spec.cjs", running mocha --enable-source-maps prints Warning: Cannot find any files matching pattern "https://json.schemastore.org/mocharc.json" before running a.spec.cjs (without the Node flag no child is started and there is no warning). Emit every option that carries a value as one "--name=value" argument, whatever its name: unparseMochaArgs({ $schema: "https://json.schemastore.org/mocharc.json" }) must give ["--$schema=https://json.schemastore.org/mocharc.json"]; unparseMochaArgs({ _: ["test/a.spec.js"], reporter: "json" }) must give ["test/a.spec.js", "--reporter=json"]; unparseMochaArgs({ require: ["tsx", "./setup.js"], timeout: "0" }) must give ["--require=tsx", "--require=./setup.js", "--timeout=0"]; unparseMochaArgs({ slow: 75 }) must give ["--slow=75"]; unparseMochaArgs({ grep: "--x" }) must give ["--grep=--x"]. What must not change: positionals come first; true gives "--name", false gives "--no-name", null and undefined give nothing (unparseMochaArgs({ bail: true, color: false, ui: null }) gives ["--bail", "--no-color"]); an array repeats the option once per item; an object value is flattened into dotted names (unparseMochaArgs({ "reporter-option": { foo: "bar", baz: true } }) still gives ["--reporter-option.foo=bar", "--reporter-option.baz"]); and unparseNodeFlags, which already writes "--name=value", is unchanged. Some existing cases in test/node-unit/cli/unparse-args.spec.js expect the two-argument form; they describe the behaviour being replaced, so update their expected arguments to the one-argument form without removing any case. Add regression tests for this behaviour to the project's existing test suite. The unit tests run with npm run test-node:unit (mocha under nyc over test/unit and test/node-unit).`,
    visible: check(
      mocha,
      `import assert from "node:assert/strict";
import { unparseMochaArgs } from "../../lib/cli/unparse-args.js";

assert.deepEqual(
  unparseMochaArgs({ $schema: "https://json.schemastore.org/mocharc.json" }),
  ["--$schema=https://json.schemastore.org/mocharc.json"],
);
console.log("visible check passed");
`,
    ),
  },
  {
    id: "acorn-bugfix-member-target-pattern-errors",
    ...acorn,
    workType: "bugfix",
    baseCommit: "d788421b2",
    upstreamCommit: "1cd3fd47d",
    hidden: {
      testFiles: ["test/tests-harmony.js"],
      argv: ["npm", "test"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: freshBehaviourCheck("acorn-behaviour-check.mjs"),
        },
      ],
      extraArgv: [["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: `acorn's parser (acorn/src/expression.js) reports two errors in an object literal only once it knows the literal is not a destructuring pattern: a shorthand property with a default, as in {a = 0}, is "Shorthand property assignments are valid only in destructuring patterns", and a second __proto__ property is "Redefinition of __proto__ property". Today both errors are lost when the object literal is the object of a member expression that is itself an assignment target, although such a literal is never a pattern: with { ecmaVersion: 2022 }, parse("({a = 0}.x = 0);") succeeds, and so do parse("[{a = 0}.x] = [];"), parse("for ({a = 0}.x of []) ;") and parse("({__proto__: 1, __proto__: 2}.x = 0);"). Each must throw a SyntaxError: "({a = 0}.x = 0);" and "[{a = 0}.x] = [];" with "Shorthand property assignments are valid only in destructuring patterns (1:4)", "for ({a = 0}.x of []) ;" with the same message at (1:8), and "({__proto__: 1, __proto__: 2}.x = 0);" with "Redefinition of __proto__ property (1:16)". The same holds wherever such a literal is the object of a member expression that is assigned to or destructured into, however deep. What must not change: real destructuring patterns still parse ("({a = 0} = {});", "[{a = 0}] = [];", "({a = 0}) => 0;"), a member expression whose object has no such property still parses as a target ("[{a: 0}.x] = [];"), and the errors acorn reports today stay as they are ("({a = 0});" throws the shorthand message at (1:4); "({a = 0} += 1);" throws "Assigning to rvalue (1:1)"). The parser's source is in acorn/src; npm test builds it and runs the test files under test/ (the parser's expression tests are in test/tests-harmony.js, written with test() and testFail()). Add regression tests for this behaviour to the project's existing test suite. The project's tests run with npm test.`,
    visible: check(
      acorn,
      `import assert from "node:assert/strict";
import { parse } from "../../acorn/src/index.js";

assert.throws(() => parse("({a = 0}.x = 0);", { ecmaVersion: 2022 }), {
  name: "SyntaxError",
  message: /Shorthand property assignments are valid only in destructuring patterns/,
});
console.log("visible check passed");
`,
    ),
  },
  {
    id: "entities-bugfix-restore-get-code-point",
    ...entities,
    workType: "bugfix",
    baseCommit: "08ef000a2",
    upstreamCommit: "c257e6c66",
    hidden: {
      testFiles: ["src/decode.spec.ts", "src/escape.spec.ts"],
      argv: ["npx", "vitest", "run", "src/decode.spec.ts", "src/escape.spec.ts"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mts",
          source: freshBehaviourCheck("entities-behaviour-check.mts"),
        },
      ],
      extraArgv: [["node", "--import=tsx", "acceptance/hidden/behaviour-check.mts"]],
    },
    immutable: [],
    taskText: `entities no longer exports getCodePoint from src/escape.ts, a helper its earlier releases exported and code that depends on the package still imports from the escape module; today importing it gives undefined. Restore it in src/escape.ts as a deprecated export (marked @deprecated in favour of String.prototype.codePointAt): getCodePoint(input, index) returns the Unicode code point that starts at index in input, reading a surrogate pair as one astral code point, and NaN where index is outside the string. getCodePoint("abc", 0) must give 97, getCodePoint("abc", 2) 99, getCodePoint("ü", 0) 252, getCodePoint("💯", 0) 128175, getCodePoint("a\u{1F4A9}", 1) 128169, and getCodePoint("abc", 3) and getCodePoint("", 0) NaN. What must not change: the other exports of src/escape.ts and their results (encodeXML(\`<a href="x">'&'</a> 💯 ü\`) gives "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt; &#128175; &#252;" and escapeUTF8 of the same string gives "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt; 💯 ü"), and the exports of src/index.ts, which do not include getCodePoint. The source is TypeScript in src/, with its vitest tests beside it (src/escape.spec.ts tests the escape module). Add regression tests for this behaviour to the project's existing test suite. The project's tests run with npm run test:vi.`,
    visible: check(
      entities,
      `import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// The source is TypeScript; tsx, a development dependency of the project, loads it.
const probe = spawnSync(
    process.execPath,
    [
        "--import=tsx",
        "--input-type=module",
        "-e",
        "import { getCodePoint } from './src/escape.ts'; console.log(getCodePoint('abc', 0));",
    ],
    { encoding: "utf8" },
);
assert.equal(probe.stdout.trim(), "97", probe.stderr);
console.log("visible check passed");
`,
    ),
  },
];
