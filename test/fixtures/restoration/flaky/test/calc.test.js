'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { add } = require('../src/calc');

describe('calc', () => {
  it('adds', () => {
    const marker = path.join(__dirname, '..', '.flake-marker');
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, 'first run failed here');
      assert.fail('first-run flake');
    }
    assert.equal(add(2, 2), 4);
  });
});
