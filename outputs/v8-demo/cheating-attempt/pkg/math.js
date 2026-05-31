// Buggy implementation: subtracts instead of adding. The contract's
// test-must-pass obligation will fail until the orchestrator's session
// produces a patch that fixes the bug.

function add(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, multiply };
