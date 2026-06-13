'use strict';

const assert = require('assert');
const { sign } = require('../src/calc');

describe('calc', () => {
  it('signs', () => {
    assert.equal(sign(0), 'nonneg');
  });
});
