// Hidden behaviour check: removeScripts and namespace-prefixed or tab/newline-split anchors.
// Written into the scoring checkout at acceptance/hidden/ only at scoring time.
import assert from 'node:assert/strict';
import { optimize } from '../../lib/svgo.js';
import { hasScripts, isExecutableUrl } from '../../lib/svgo/tools.js';

const corpus = __CORPUS__;
const expected = __EXPECTED__;
const presetCorpus = __PRESET_CORPUS__;
const presetExpected = __PRESET_EXPECTED__;

const failures = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push(`${name}: ${String(error && error.message).split('\n').slice(0, 4).join(' | ')}`);
  }
};

corpus.forEach((svg, i) => {
  check(`removeScripts on case #${i}`, () => {
    assert.equal(optimize(svg, { plugins: ['removeScripts'] }).data, expected[i]);
  });
});

presetCorpus.forEach((svg, i) => {
  check(`preset-default on case #${i}`, () => {
    assert.equal(optimize(svg).data, presetExpected[i]);
  });
});

check('isExecutableUrl ignores ASCII tab, line feed and carriage return', () => {
  for (const value of [
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    '\n\t JAVA\tSCRIPT:x',
    'vb\nscript:msgbox(1)',
    'data:text/ht\nml,<script>alert(1)</script>',
    'data:image/svg\t+xml;base64,PHN2Zz4=',
    'data:application/xhtml\r+xml,x',
  ]) {
    assert.equal(isExecutableUrl(value), true, JSON.stringify(value));
  }
  for (const value of [
    'https://example.com/a\tb',
    'java script:alert(1)',
    'javascript',
    '#java\tscript:',
    'data:image/png;base64,AA\nAA',
    'data:text/plain,java\tscript:x',
  ]) {
    assert.equal(isExecutableUrl(value), false, JSON.stringify(value));
  }
});

check('hasScripts sees tab-split executable links', () => {
  const anchor = (href) => ({ type: 'element', name: 'a', attributes: { href }, children: [] });
  assert.equal(hasScripts(anchor('java\tscript:x')), true);
  assert.equal(hasScripts(anchor('java\nscript:x')), true);
  assert.equal(hasScripts(anchor('https://example.com/')), false);
});

if (failures.length > 0) {
  console.error(`${failures.length} behaviour check(s) failed:`);
  for (const failure of failures.slice(0, 40)) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log('behaviour check passed');
