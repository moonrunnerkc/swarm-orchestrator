import assert from 'node:assert/strict';
import { optimize } from '../../lib/svgo.js';

const { data } = optimize(
  '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#9;script:alert(1)"><rect width="1" height="1"/></a></svg>',
  { plugins: ['removeScripts'] },
);
assert.equal(
  data,
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
);
console.log('visible check passed');
