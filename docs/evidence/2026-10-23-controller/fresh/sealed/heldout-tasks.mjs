/**
 * Fresh block 2 (2026-10-23): three tasks selected by
 * docs/evidence/2026-10-23-controller/heldout-2-selection-rule.md (registered in aba45f0d1), one
 * per family, from markdown-it/markdown-it and svg/svgo, in the shape of
 * scripts/comparison/tasks.mjs and of block 1's module. Task text was written from the base's
 * observed behaviour and the upstream change without naming it. Hidden behaviour checks are read
 * from this sealed directory by absolute path and written into the scoring checkout under
 * acceptance/hidden/ only at scoring.
 *
 * markdown-it commits its package-lock.json, so its install is `npm ci`; svgo commits only a
 * pnpm lockfile (and a pnpm patch to sax that only removes stream support), so its install is
 * `npm install` pinned to the registry as it stood before the block was registered.
 */
import { readFileSync } from "node:fs";

const sealed = "/Users/brad/.cache/swarm-heldout-2026-10-23/sealed";
const hiddenSource = (path) => readFileSync(`${sealed}/${path}`, "utf8");

const npmCi = ["npm", "ci", "--ignore-scripts"];
const pinnedInstall = [
  "npm",
  "install",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "--before=2026-10-23T00:00:00.000Z",
];

const markdownIt = {
  repository: "markdown-it/markdown-it",
  install: [npmCi],
  build: [],
  // The project's npm test is eslint, the build, (from the TypeScript migration on) tsc, then
  // node --test over test/cmspec, test/markdown-it and test/build.
  projectTest: ["npm", "test"],
  visiblePrefix: "",
};

const svgo = {
  repository: "svg/svgo",
  install: [pinnedInstall],
  build: [],
  // The project's npm test is vitest run, with type checking of the JavaScript enabled.
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
    id: "markdown-it-feature-reference-definition-token",
    ...markdownIt,
    workType: "feature",
    baseCommit: "6c60e2157",
    upstreamCommit: "5915b84a6",
    hidden: {
      testFiles: ["test/markdown-it/misc.test.mjs"],
      argv: ["node", "--test", "test/markdown-it/misc.test.mjs"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: hiddenSource("mdit-feature/behaviour-check.mjs"),
        },
      ],
      extraArgv: [["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: "markdown-it's block parser recognises link reference definitions such as [foo]: /url \"title\" (src/rules_block/reference.ts) and records them in env.references, but it leaves nothing in the token stream, so a plugin cannot tell where a definition stood in the source. Make every definition the block parser recognises push a token of type reference_definition at the place the definition takes in the block token stream, with nesting 0, an empty tag, hidden true, block true, the current block level, map set to [first line, line after the last line] of the definition (a definition spread over several lines covers all of them), and meta built the way the link and image tokens that use a reference already build theirs: an object with no prototype (Object.create(null)) whose label is the normalized label, the key env.references uses (so [Foo Bar]: /x gives the label \"FOO BAR\"). A later duplicate definition, whose label env.references already holds, still gets its own token, while env.references keeps the first definition as it does today. Existing plugins that walk block tokens do not expect the new type, so also add a core rule named strip_references that runs right after the block core rule and before inline and removes these tokens, and enable it in all three presets (default, commonmark and zero), so that by default md.parse returns exactly the token stream it returns today. Disabling the rule (md.core.ruler.disable('strip_references'), or md.disable('strip_references')) keeps the tokens, and md.enable('strip_references') removes them again. Hidden tokens render to nothing, but the renderer decides line feeds from the tokens directly before and after a block tag (Renderer#renderToken in src/renderer.ts), so today a kept reference_definition token would change the HTML around neighbouring blocks. With the tokens kept, md.render and md.renderer.render must produce exactly the HTML that the default configuration produces: for example, with the rule disabled, md.render('1. [foo]: /url') must still be '<ol>\\n<li></li>\\n</ol>\\n'. What must not change: with the default configuration of every preset, md.parse(src, env) yields the same tokens with the same fields, env.references gets the same entries, and md.render gives the same HTML as today for every input, with any options; the CommonMark spec tests keep passing; and disabling the rule on one MarkdownIt instance does not affect another. The source is TypeScript under src/ (core rules in src/rules_core/, registered in src/parser_core.ts; presets in src/presets/; the renderer in src/renderer.ts), run by Node directly; the tests are node:test files under test/, with parser behaviour in test/markdown-it/misc.test.mjs. Add regression tests for this behaviour to the project's existing test suite. The project's tests run with npm test (eslint, the build, tsc --noEmit, then node --test over test/cmspec, test/markdown-it and test/build).",
    visible: check(markdownIt, "import assert from 'node:assert/strict'\nimport markdownit from '../../src/index.ts'\n\nconst md = markdownit()\nmd.core.ruler.disable('strip_references')\nconst tokens = md.parse('[foo]: /url\\n', {})\nassert.equal(tokens.filter(token => token.type === 'reference_definition').length, 1)\nconsole.log('visible check passed')\n"),
  },
  {
    id: "markdown-it-refactor-ts-file-extensions",
    ...markdownIt,
    workType: "refactor",
    baseCommit: "9f1157c6d",
    upstreamCommit: "2b49966fa",
    hidden: {
      // The upstream commit's own test changes only follow the renamed paths, so none is overlaid:
      // the candidate's own updated suite runs, and the behaviour check reads every reference.
      testFiles: [],
      argv: ["npm", "test"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: hiddenSource("mdit-rename/behaviour-check.mjs"),
        },
      ],
      extraArgv: [["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: "markdown-it's source is written as ES modules with the .mjs extension: all 53 modules under src/ (src/index.mjs, src/markdownit.mjs, src/parser_*.mjs, src/renderer.mjs, src/ruler.mjs, src/token.mjs and everything in src/common/, src/helpers/, src/presets/, src/rules_block/, src/rules_core/ and src/rules_inline/). Rename every one of them to the same path with the .ts extension (src/index.mjs to src/index.ts, src/rules_block/list.mjs to src/rules_block/list.ts, and so on), as the first step of moving the source to TypeScript, with behaviour unchanged. Node 24 runs .ts files directly by stripping types, so the renamed files stay plain JavaScript: do not add type annotations or change the code, and keep each file's content as it is apart from the module paths it imports (comments that link to a source file may follow the rename). Move each file so that no module remains under its old name and no .mjs file is left under src/, and do not leave files under the old names (no re-exporting stubs). Update every reference to an old path: the imports between modules in src/, the static and dynamic imports in the tests under test/, the bundle entries in support/build-dist.mjs, and the other scripts under support/ and benchmark/ that import the sources. Behaviour must not change: each renamed module exports exactly what it exported before; importing src/index.ts gives the same markdownit factory and the same output for every input and option set; Node prints no warning when the renamed sources load that it does not print for the current .mjs files (for example a warning about the module type of a .ts file); npm run build still produces dist/markdown-it.mjs, dist/markdown-it.cjs.js and the browser bundles with the same behaviour; and the command-line tool bin/markdown-it.mjs, which uses the built package, prints the same HTML. Adding a TypeScript configuration or a type-check script is not required. The tests are node:test files under test/, and the project's tests run with npm test (eslint, the build, then node --test over test/cmspec, test/markdown-it and test/build), which must keep passing.",
    visible: check(markdownIt, "import assert from 'node:assert/strict'\nimport { existsSync } from 'node:fs'\nimport markdownit from '../../src/index.ts'\n\nassert.equal(markdownit().render('*x*'), '<p><em>x</em></p>\\n')\nassert.equal(existsSync(new URL('../../src/renderer.ts', import.meta.url)), true)\nconsole.log('visible check passed')\n"),
  },
  {
    id: "svgo-bugfix-remove-scripts-anchor-bypass",
    ...svgo,
    workType: "bugfix",
    baseCommit: "4e9b9aed2",
    upstreamCommit: "3db3ef33e",
    hidden: {
      testFiles: ["test/plugins/removeScripts.11.svg.txt"],
      argv: ["npx", "vitest", "run", "test/plugins/_index.test.js"],
      files: [
        {
          path: "acceptance/hidden/behaviour-check.mjs",
          source: hiddenSource("svgo-bugfix/behaviour-check.mjs"),
        },
      ],
      extraArgv: [["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText: "svgo's removeScripts plugin (plugins/removeScripts.js) removes scripting from an SVG: script elements, event attributes, executable attributes of HTML inside foreignObject, and links with an executable URL. A link is an <a> element whose href or *:href attribute is a javascript: or vbscript: URL, or a data: URL of an HTML, XHTML or SVG document; the plugin replaces such an element by its element children (its text children are dropped). Whether a URL is executable is decided by isExecutableUrl in lib/svgo/tools.js, which hasScripts in the same file also uses, so other plugins (cleanupIds, minifyStyles, removeHiddenElems, removeUselessStrokeAndFill) leave documents with executable links alone. Two kinds of executable link survive today. First, an SVG anchor written with a namespace prefix: in <svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:svg=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><svg:a xlink:href=\"javascript:alert(1)\"><rect width=\"1\"/></svg:a></svg> the svg:a element is kept with its link, although it is an SVG <a>. Second, a URL whose scheme is split by ASCII tab, line feed or carriage return characters, such as href=\"java&#9;script:alert(1)\": browsers remove those characters from a URL before parsing it, so the link runs, but isExecutableUrl does not recognise it. Fix both. An element is an SVG anchor when its local name is a and it is unprefixed (as today) or its prefix resolves to the SVG namespace http://www.w3.org/2000/svg through the xmlns: declarations in scope at that element, counting declarations on the element itself and, where a prefix is redeclared on a descendant, the innermost one; an a element whose prefix resolves to another namespace is not an anchor and keeps its attributes and children. isExecutableUrl must ignore ASCII tab (U+0009), line feed (U+000A) and carriage return (U+000D) anywhere in the value, so that every user of it (removeScripts for links and for URL attributes of HTML inside foreignObject, and hasScripts) treats such a URL as executable: for example isExecutableUrl('java\\tscript:alert(1)') and isExecutableUrl('data:text/ht\\nml,x') must be true. What must not change: unprefixed anchors are handled as today; links with non-executable URLs (https: and relative URLs, #fragments, data:image/png and other inert data URLs, a scheme broken by a space) are kept; an anchor whose prefix resolves to another namespace is kept; script elements (prefixed or not, in the SVG or XHTML namespace), event attributes, and srcdoc, on* and executable URL attributes of HTML inside foreignObject are removed as today; and the output of every plugin, preset-default included, is unchanged for documents without such links. The plugin tests are fixture files test/plugins/<plugin>.<n>.svg.txt (a description, ===, the input, @@@, the expected output), run by test/plugins/_index.test.js. Add regression tests for this behaviour to the project's existing test suite. The project's tests run with npm test (vitest run, which also type-checks the JavaScript under tsconfig.json's strict checkJs).",
    visible: check(svgo, "import assert from 'node:assert/strict';\nimport { optimize } from '../../lib/svgo.js';\n\nconst { data } = optimize(\n  '<svg xmlns=\"http://www.w3.org/2000/svg\"><a href=\"java&#9;script:alert(1)\"><rect width=\"1\" height=\"1\"/></a></svg>',\n  { plugins: ['removeScripts'] },\n);\nassert.equal(\n  data,\n  '<svg xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"1\" height=\"1\"/></svg>',\n);\nconsole.log('visible check passed');\n"),
  },
];
