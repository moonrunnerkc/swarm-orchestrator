import { describe, expect, it } from "vitest";
import { pairRenames, type RenameTrees, transportedEqual } from "./rename-transport.ts";

function trees(
  reference: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): RenameTrees {
  const listed = new Set([...Object.keys(reference), ...Object.keys(current)]);
  return {
    reference: async (path) => reference[path] ?? null,
    current: async (path) => current[path] ?? null,
    changed: [...listed].filter((path) => reference[path] !== current[path]),
    listed,
  };
}

describe("pairing a patch's renames", () => {
  it("pairs a moved file whose only change is the references it makes to other moved files", async () => {
    const map = await pairRenames(
      trees(
        {
          "lib/handleRequest.js": "const wrap = require('./wrapThenable')\nmodule.exports = wrap\n",
          "lib/wrapThenable.js": "module.exports = function wrapThenable () {}\n",
        },
        {
          "lib/handle-request.js":
            "const wrap = require('./wrap-thenable')\nmodule.exports = wrap\n",
          "lib/wrap-thenable.js": "module.exports = function wrapThenable () {}\n",
        },
      ),
    );
    expect(map.pairs.map(({ from, to }) => [from, to])).toEqual([
      ["lib/handleRequest.js", "lib/handle-request.js"],
      ["lib/wrapThenable.js", "lib/wrap-thenable.js"],
    ]);
    expect(map.residuals).toEqual([]);
  });

  it("pairs an extension change whose imports follow it", async () => {
    const map = await pairRenames(
      trees(
        {
          "src/index.mjs": "import a from './rules/a.mjs'\nexport default a\n",
          "src/rules/a.mjs": "export default 1\n",
        },
        {
          "src/index.ts": "import a from './rules/a.ts'\nexport default a\n",
          "src/rules/a.ts": "export default 1\n",
        },
      ),
    );
    expect(map.pairs.map(({ from, to }) => [from, to])).toEqual([
      ["src/index.mjs", "src/index.ts"],
      ["src/rules/a.mjs", "src/rules/a.ts"],
    ]);
  });

  it("does not pair a stub left at the new path with the module it replaced", async () => {
    const map = await pairRenames(
      trees(
        { "lib/a.js": "module.exports = function a (x) { return x + 1 }\n" },
        { "lib/b.js": "module.exports = function a (x) { return 0 }\n" },
      ),
    );
    expect(map.pairs).toEqual([]);
  });

  it("drops a pair that only held through another pair that falls out", async () => {
    // index moves with a reference to util; util's new content is a different function, so util
    // is no rename, and index's changed word then names no renamed file.
    const map = await pairRenames(
      trees(
        {
          "src/index.js": "module.exports = require('./util.js')\n",
          "src/util.js": "module.exports = (a) => a * 2\n",
        },
        {
          "src/main.js": "module.exports = require('./helpers.js')\n",
          "src/helpers.js": "module.exports = (a) => 0\n",
        },
      ),
    );
    expect(map.pairs).toEqual([]);
  });

  it("does not guess between two equally good targets", async () => {
    const map = await pairRenames(
      trees(
        { "lib/a.js": "module.exports = 1\n" },
        { "src/x.js": "module.exports = 1\n", "src/y.js": "module.exports = 1\n" },
      ),
    );
    expect(map.pairs).toEqual([]);
    expect(map.residuals).toEqual(["lib/a.js matches 2 added files equally; not paired"]);
  });
});

describe("a file read as its base content with moved references", () => {
  const reference = {
    "lib/configValidator.js": "// generated\nmodule.exports = {}\n",
    "eslint.config.js":
      "module.exports = [{ ignores: ['lib/configValidator.js', 'lib/error-serializer.js'] }]\n",
    "lib/error-serializer.js": "// generated\n",
  };
  const current = {
    "lib/config-validator.js": "// generated\nmodule.exports = {}\n",
    "eslint.config.js":
      "module.exports = [{ ignores: ['lib/config-validator.js', 'lib/error-serializer.js'] }]\n",
    "lib/error-serializer.js": "// generated\n",
  };

  it("accepts an ignore entry that follows the rename", async () => {
    const map = await pairRenames(trees(reference, current));
    expect(
      transportedEqual(
        map,
        reference["eslint.config.js"],
        "eslint.config.js",
        current["eslint.config.js"],
        "eslint.config.js",
      ),
    ).toBe(true);
  });

  it.each([
    [
      "a rule switched off beside the moved entry",
      "module.exports = [{ ignores: ['lib/config-validator.js', 'lib/error-serializer.js'], rules: { 'no-undef': 'off' } }]\n",
    ],
    [
      "a source directory added to the ignore list",
      "module.exports = [{ ignores: ['lib/config-validator.js', 'lib/'] }]\n",
    ],
    [
      "an entry moved to a file that is not the renamed one",
      "module.exports = [{ ignores: ['lib/fastify.js', 'lib/error-serializer.js'] }]\n",
    ],
  ])("refuses %s", async (_name, edited) => {
    const map = await pairRenames(trees(reference, { ...current, "eslint.config.js": edited }));
    expect(
      transportedEqual(
        map,
        reference["eslint.config.js"],
        "eslint.config.js",
        edited,
        "eslint.config.js",
      ),
    ).toBe(false);
  });

  it("refuses an edit when the patch renames nothing", async () => {
    const map = await pairRenames(trees({ "a.js": "x" }, { "a.js": "y" }));
    expect(transportedEqual(map, "x", "a.js", "y", "a.js")).toBe(false);
  });

  it("reads a stub key relative to the module it stubs", async () => {
    const before = {
      "lib/handleRequest.js": "module.exports = require('./wrapThenable')\n",
      "lib/wrapThenable.js": "module.exports = 1\n",
      "test/internals/handle-request.test.js":
        "proxyquire('../../lib/handleRequest', { './wrapThenable': stub })\n",
    };
    const after = {
      "lib/handle-request.js": "module.exports = require('./wrap-thenable')\n",
      "lib/wrap-thenable.js": "module.exports = 1\n",
      "test/internals/handle-request.test.js":
        "proxyquire('../../lib/handle-request', { './wrap-thenable': stub })\n",
    };
    const map = await pairRenames(trees(before, after));
    const path = "test/internals/handle-request.test.js";
    expect(transportedEqual(map, before[path], path, after[path], path)).toBe(true);
  });

  it("reads a comment's link to the renamed file in the project's repository", async () => {
    const link = (file: string) =>
      `/** See [source](https://github.com/o/r/blob/master/src/${file}). */\nexport default 1\n`;
    const map = await pairRenames(
      trees(
        { "src/renderer.mjs": link("renderer.mjs") },
        { "src/renderer.ts": link("renderer.ts") },
      ),
    );
    expect(map.pairs.map(({ from, to }) => [from, to])).toEqual([
      ["src/renderer.mjs", "src/renderer.ts"],
    ]);
    const elsewhere = await pairRenames(
      trees({ "src/renderer.mjs": link("renderer.mjs") }, { "src/renderer.ts": link("token.ts") }),
    );
    expect(elsewhere.pairs).toEqual([]);
  });

  it("reads a build entry that names the renamed entry point", async () => {
    const before = {
      "src/index.mjs": "export default 1\n",
      "support/build-dist.mjs": "build({ lib: { entry: 'src/index.mjs', formats: ['cjs'] } })\n",
    };
    const after = {
      "src/index.ts": "export default 1\n",
      "support/build-dist.mjs": "build({ lib: { entry: 'src/index.ts', formats: ['cjs'] } })\n",
    };
    const map = await pairRenames(trees(before, after));
    const path = "support/build-dist.mjs";
    expect(transportedEqual(map, before[path], path, after[path], path)).toBe(true);
    const dropped = "build({ lib: { entry: 'src/index.ts', formats: [] } })\n";
    expect(transportedEqual(map, before[path], path, dropped, path)).toBe(false);
  });
});
