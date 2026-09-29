const test = require('node:test');
const assert = require('node:assert');
const { sum } = require('../../src/sum.js');

test('sums every element', () => {
  assert.strictEqual(sum([1, 2, 3]), 6);
});

test('empty array sums to zero', () => {
  assert.strictEqual(sum([]), 0);
});
