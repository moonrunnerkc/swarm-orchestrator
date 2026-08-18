"use strict";

/**
 * The diff reader. `parseUnifiedDiff` is handed git's own output and stored patches, and what
 * it returns becomes the changed-file set the file-set check compares a declaration against,
 * and the added lines the coverage arm asks about.
 *
 * The text is untrusted in the way that matters here: the diff is of code a model wrote, so
 * every hunk body is attacker-influenced even though the framing lines come from git. A body
 * line that starts with `+++` or `@@` is ordinary content in a patch about patches, and a
 * reader that cannot tell a hunk header from a line inside a hunk attributes changes to the
 * wrong file, which is exactly the confusion a declared file set exists to catch.
 *
 * What is under test:
 *   - no input makes the parser throw
 *   - a file that comes back is named, and named once
 *   - an added line's number is a real line number, and they ascend within a file
 *   - reconstructing both sides of a parsed diff does not throw on anything it produced
 */

const { strict: assert } = require("node:assert");

const { parseUnifiedDiff, reconstructSides } = require(
  "../.swarm/fuzz-build/gates/unified-diff.js",
);

module.exports.fuzz = function (data) {
  const text = data.toString("utf8");
  const files = parseUnifiedDiff(text);
  assert.ok(Array.isArray(files), "the parser returned something other than a list of files");

  const seen = new Set();
  for (const file of files) {
    assert.equal(typeof file.path, "string", "a changed file came back with no path");
    assert.ok(file.path.length > 0, "a changed file came back named the empty string");
    assert.ok(
      !seen.has(file.path),
      `${file.path} came back twice, so one entry's lines are attributed to the other`,
    );
    seen.add(file.path);

    let previous = 0;
    for (const added of file.addedLines ?? []) {
      assert.ok(
        Number.isInteger(added.line) && added.line > 0,
        `${file.path} added line ${String(added.line)}, which is not a line number`,
      );
      assert.ok(
        added.line > previous,
        `${file.path} added line ${added.line} after ${previous}, so the hunks were read out of order`,
      );
      previous = added.line;
      assert.equal(typeof added.text, "string", `${file.path} added a line with no text`);
    }
  }

  // The other reader of the same bytes. Both are used to measure one patch, so a text the
  // parser accepts and this one throws on is a disagreement about what the patch says.
  const sides = reconstructSides(text);
  for (const [path, side] of sides) {
    assert.equal(typeof side.base, "string", `${path} reconstructed a base that is not text`);
    assert.equal(typeof side.head, "string", `${path} reconstructed a head that is not text`);
  }
};
