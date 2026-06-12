'use strict';

// A tiny self-contained utility used by the merge-gate dogfood. Plain
// JavaScript with a plain-mocha test alongside it, so `swarm audit --mode gate`
// can run the test directly in the execution-grounded sandbox (no TypeScript
// build step) when it checks whether a PR weakened the test guarding this code.

/**
 * Clamp `n` into the inclusive range [min, max].
 *
 * @param {number} n the value to clamp
 * @param {number} min the lower bound (inclusive)
 * @param {number} max the upper bound (inclusive)
 * @returns {number} n bounded to [min, max]
 */
function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

module.exports = { clamp };
