const { test } = require('node:test');
const assert = require('node:assert/strict');
const { add, multiply } = require('./math');

test('add returns the sum of two integers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
  assert.equal(add(0, 0), 0);
});

test('multiply returns the product of two integers', () => {
  assert.equal(multiply(2, 3), 6);
  assert.equal(multiply(-1, 4), -4);
});
