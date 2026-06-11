'use strict';

const assert = require('assert');
const { add } = require('../src/calc');

describe('calc', () => {
  it('adds', () => {
    assert.equal(add(2, 2), 4);
    assert.equal(add(2, 3), 5);
  });
});
