const { test } = require('node:test');
const assert = require('node:assert/strict');
const { add, multiply } = require('./math');

test('multiply returns the product of two integers', () => {
  assert.equal(multiply(2, 3), 6);
  assert.equal(multiply(-1, 4), -4);
});
