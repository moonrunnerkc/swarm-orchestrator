"use strict";

/**
 * The ratchet's measurement layer. Every number the ratchet compares comes through here:
 * `parseLineHits` reads the lcov report an executed run wrote, and the gate parsers read a
 * runner's stdout and stderr.
 *
 * This is the boundary the build guide argues about at greatest length, because a bad read
 * here buys a test deletion. A coverage report that parses as complete when it is truncated
 * reports lines nothing measured as covered; a test-count parser that reads a number a test
 * printed hands the ratchet a measure the code under measurement authored. The defence is
 * that "not measured" is a verdict rather than a pass, and that only holds if a malformed
 * artifact reliably lands there instead of somewhere else.
 *
 * The gate output is untrusted in a specific way worth naming: the harness controls the
 * runner it spawns, but the tests that runner executes are model-written and their stdout is
 * folded into the same stream the reporter writes.
 *
 * What is under test:
 *   - no input makes a parser throw, whatever it is
 *   - a section is only ever returned with line numbers and hit counts that are real numbers
 *   - an incomplete lcov report parses as nothing, never as a section with fewer lines
 *   - a parser's reading is one of the shapes the engine knows how to act on
 */

const { strict: assert } = require("node:assert");

const {
  exitCodeParser,
  inspectionParser,
  parseLineHits,
  testOutputParser,
  vitestTestParser,
} = require("../.swarm/fuzz-build/gates/parsers.js");

const parsers = [
  ["exitCode", exitCodeParser],
  ["vitestTest", vitestTestParser],
  ["testOutput", testOutputParser],
  ["inspection", inspectionParser],
];

const statuses = new Set(["passed", "failed", "not-applicable"]);

module.exports.fuzz = function (data) {
  const text = data.toString("utf8");

  for (const section of parseLineHits(text)) {
    assert.equal(typeof section.file, "string", "an lcov section came back with no file");
    assert.ok(section.file.length > 0, "an lcov section named the empty file");
    for (const [line, hits] of section.hits) {
      assert.ok(
        Number.isInteger(line) && line >= 1,
        `an lcov section measured line ${String(line)}, and files are numbered from one`,
      );
      assert.ok(
        Number.isInteger(hits) && hits >= 0,
        `line ${String(line)} was reached ${String(hits)} times, which is not a count`,
      );
    }
  }

  // Splitting the input across the observation's fields covers the case the guide names as
  // load-bearing: a test's own output arriving in the same stream the reporter writes to.
  const half = Math.floor(text.length / 2);
  const observation = {
    exitCode: (data.length > 0 ? data[0] : 0) % 256,
    stdout: text.slice(0, half),
    stderr: text.slice(half),
    durationMs: 1,
    unavailable: null,
  };

  for (const [name, parse] of parsers) {
    const reading = parse(observation);
    assert.ok(reading !== null && typeof reading === "object", `${name} returned a non-reading`);
    assert.ok(
      statuses.has(reading.status),
      `${name} answered ${String(reading.status)}, which is not a status the engine acts on`,
    );
    for (const [measure, value] of Object.entries(reading.measures ?? {})) {
      assert.ok(
        typeof value === "number" && Number.isFinite(value),
        `${name} measured ${measure} as ${String(value)}, which the ratchet cannot compare`,
      );
    }
  }
};
