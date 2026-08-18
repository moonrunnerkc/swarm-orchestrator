"use strict";

/**
 * The claim predicate language. This is the one parser in the tree whose input is written
 * by the model directly: a claim carries a predicate string, and the harness parses and
 * evaluates it to decide whether the claim renders VERIFIED.
 *
 * Invariant 1 makes the property here unusually sharp. "Missing records, kind mismatches,
 * and unparseable predicates render UNVERIFIED; they never abort the run." So a predicate
 * that cannot be read is a normal outcome with a named error, and any other way out of
 * this function is an invariant violation by definition rather than by judgement. A model
 * that can abort the run by emitting a particular predicate can stop its own work being
 * checked.
 *
 * What is under test:
 *   - parsing settles as a node or as PredicateParseError, never anything else
 *   - evaluating a node the parser accepted never throws, against any payload
 *   - a result is either a boolean verdict or a named failure, never a half-built object
 *   - parsing is deterministic: the same source twice gives the same tree
 */

const { strict: assert } = require("node:assert");

const { PredicateParseError, evaluatePredicate, parsePredicate } = require(
  "../.swarm/fuzz-build/evidence/predicate.js",
);

const failures = new Set(["path-not-found", "type-mismatch"]);

/** Payloads a claim is evaluated against, covering the shapes a record's payload can take. */
const subjects = [
  { exitCode: 0, gate: "lint", passed: true },
  { nested: { deep: { count: 42 } } },
  { list: [1, 2, 3], empty: [], nothing: null },
  {},
  { "odd key": "value", "": "empty name" },
];

module.exports.fuzz = function (data) {
  const source = data.toString("utf8");

  let node;
  try {
    node = parsePredicate(source);
  } catch (error) {
    // The one sanctioned way out. Anything else aborts a run that invariant 1 says must
    // carry on and render the claim unverified.
    if (!(error instanceof PredicateParseError)) {
      throw error;
    }
    return;
  }

  assert.ok(node !== null && typeof node === "object", "the parser returned a non-node");
  assert.equal(
    typeof node.kind,
    "string",
    "the parser returned a node with no kind, so evaluation reads an unhandled shape",
  );

  const again = parsePredicate(source);
  assert.deepEqual(again, node, "parsing the same source twice gave two different trees");

  for (const subject of subjects) {
    const result = evaluatePredicate(node, subject);
    assert.ok(result !== null && typeof result === "object", "evaluation returned a non-result");

    if (result.ok === true) {
      assert.equal(
        typeof result.value,
        "boolean",
        "a satisfied predicate answered with something other than a verdict",
      );
      continue;
    }
    assert.equal(result.ok, false, "a result was neither ok nor not-ok");
    assert.ok(
      failures.has(result.failure),
      `evaluation failed as ${String(result.failure)}, which is not a named failure`,
    );
    assert.equal(typeof result.detail, "string", "a failure carried no detail for the reviewer");
  }
};
