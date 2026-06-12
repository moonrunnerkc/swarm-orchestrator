'use strict';

const assert = require('assert');
const { clamp } = require('./clamp');

describe('clamp', () => {
  it('returns the value when it is inside the range', () => {
    assert.strictEqual(clamp(5, 0, 10), 5);
  });

  it('caps a value above the max at the max', () => {
    assert.strictEqual(clamp(15, 0, 10), 10);
  });

  it('raises a value below the min to the min', () => {
    assert.strictEqual(clamp(-3, 0, 10), 0);
  });
});
