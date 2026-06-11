'use strict';

const assert = require('assert');
const { add } = require('../src/calc');

describe('calc', () => {
  it('adds', () => {
    assert.equal(add(2, 2), 5);
  });
});
