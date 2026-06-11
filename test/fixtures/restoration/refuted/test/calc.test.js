'use strict';

const assert = require('assert');
const { add } = require('../src/calc');

describe('calc', () => {
  it('adds', () => {
    const result = add(2, 2);
    assert.equal(result, 4);
  });
});
