// Hidden behaviour check: removeScripts and namespace-prefixed or tab/newline-split anchors.
// Written into the scoring checkout at acceptance/hidden/ only at scoring time.
import assert from 'node:assert/strict';
import { optimize } from '../../lib/svgo.js';
import { hasScripts, isExecutableUrl } from '../../lib/svgo/tools.js';

const corpus = [
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\"><svg:a xlink:href=\"javascript:alert(1)\"><text>prefixed</text></svg:a><rect width=\"1\"/></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><s:a xmlns:s=\"http://www.w3.org/2000/svg\" href=\"javascript:void 0\"><rect width=\"2\"/><circle r=\"1\"/></s:a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:x=\"https://example.com/other\"><g xmlns:x=\"http://www.w3.org/2000/svg\"><x:a href=\"javascript:1\"><path d=\"M0 0\"/></x:a></g></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\"><svg:a href=\"java&#9;script:alert(1)\"><text>both</text></svg:a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"java&#9;script:alert(1)\"><text>tab</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a xlink:href=\"java&#10;script:alert(1)\"><text>lf</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"java&#13;script:alert(1)\"><text>cr</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"j&#9;a&#10;v&#13;a&#9;s&#10;cript:alert(1)\"><text>mixed</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"JaVa&#9;ScRiPt:alert(1)\"><text>case</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"vb&#9;script:msgbox(1)\"><text>vb</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"data:text/ht&#10;ml,&lt;script&gt;alert(1)&lt;/script&gt;\"><text>data</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\"><foreignObject width=\"10\" height=\"10\"><xhtml:iframe src=\"java&#9;script:alert(1)\" title=\"f\"/><xhtml:a href=\"java&#10;script:x\" class=\"k\">k</xhtml:a></foreignObject></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:custom=\"https://example.com/other\"><custom:a href=\"javascript:alert(1)\"><text>custom</text></custom:a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:x=\"http://www.w3.org/2000/svg\"><g xmlns:x=\"https://example.com/other\"><x:a href=\"javascript:1\"><path d=\"M1 1\"/></x:a></g><x:a href=\"javascript:2\"><path d=\"M2 2\"/></x:a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\"><svg:a href=\"https://example.com/\"><text>safe prefixed</text></svg:a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"https://example.com/java&#9;script:x\"><text>t</text></a><a href=\"#frag\"><text>f</text></a><a xlink:href=\"data:image/png;base64,AAAA\"><text>p</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"javascript-docs.html\"><text>d</text></a><a href=\"java script:alert(1)\"><text>s</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"&#10;&#9; javascript:alert(1)\"><text>leading</text></a></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\"><script>alert(1)</script><svg:script>alert(2)</svg:script><rect onclick=\"alert(3)\" width=\"3\"/><foreignObject><xhtml:script>x</xhtml:script><xhtml:div onmouseover=\"y\" srcdoc=\"z\">v</xhtml:div></foreignObject></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><g><rect width=\"1\"/><a href=\"javascript:x\">  <rect width=\"2\"/>text<circle r=\"3\"/></a><rect width=\"4\"/></g></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\"><a href=\"javascript:a\"><path d=\"M0 0\"/></a><svg:a xlink:href=\"vbscript:b\"><path d=\"M1 1\"/></svg:a><a href=\"java&#10;script:c\"><path d=\"M2 2\"/></a></svg>"
];
const expected = ["<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\"><text>prefixed</text><rect width=\"1\"/></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><rect width=\"2\"/><circle r=\"1\"/></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:x=\"https://example.com/other\"><g xmlns:x=\"http://www.w3.org/2000/svg\"><path d=\"M0 0\"/></g></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\"><text>both</text></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><text>tab</text></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><text>lf</text></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><text>cr</text></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><text>mixed</text></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><text>case</text></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><text>vb</text></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><text>data</text></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\"><foreignObject width=\"10\" height=\"10\"><xhtml:iframe title=\"f\"/><xhtml:a class=\"k\">k</xhtml:a></foreignObject></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:custom=\"https://example.com/other\"><custom:a href=\"javascript:alert(1)\"><text>custom</text></custom:a></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:x=\"http://www.w3.org/2000/svg\"><g xmlns:x=\"https://example.com/other\"><x:a href=\"javascript:1\"><path d=\"M1 1\"/></x:a></g><path d=\"M2 2\"/></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\"><svg:a href=\"https://example.com/\"><text>safe prefixed</text></svg:a></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"https://example.com/java\tscript:x\"><text>t</text></a><a href=\"#frag\"><text>f</text></a><a xlink:href=\"data:image/png;base64,AAAA\"><text>p</text></a></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><a href=\"javascript-docs.html\"><text>d</text></a><a href=\"java script:alert(1)\"><text>s</text></a></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><text>leading</text></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\"><rect width=\"3\"/><foreignObject><xhtml:div>v</xhtml:div></foreignObject></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><g><rect width=\"1\"/><rect width=\"2\"/><circle r=\"3\"/><rect width=\"4\"/></g></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:svg=\"http://www.w3.org/2000/svg\"><path d=\"M0 0\"/><path d=\"M1 1\"/><path d=\"M2 2\"/></svg>"];
const presetCorpus = [
  "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"100\" height=\"100\" viewBox=\"0 0 100 100\"><defs><linearGradient id=\"grad\"><stop offset=\"0\" stop-color=\"#ff0000\"/></linearGradient></defs><g id=\"unused\"><a href=\"https://example.com/\"><rect x=\"0.000\" y=\"0\" width=\"10.50\" height=\"10\" fill=\"url(#grad)\"/></a><a xlink:href=\"#grad\"><circle cx=\"5\" cy=\"5\" r=\"2\" fill=\"#FFFFFF\"/></a></g><image xlink:href=\"data:image/png;base64,AAAA\" width=\"1\" height=\"1\"/></svg>",
  "<svg xmlns=\"http://www.w3.org/2000/svg\"><style>.a{fill:red}</style><g><a href=\"java&#9;script:alert(1)\"><rect class=\"a\" id=\"r1\" width=\"5\" height=\"5\"/></a><use href=\"#r1\"/></g></svg>"
];
const presetExpected = ["<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"100\" height=\"100\" viewBox=\"0 0 100 100\"><defs><linearGradient id=\"a\"><stop offset=\"0\" stop-color=\"red\"/></linearGradient></defs><a><path fill=\"url(#a)\" d=\"M0 0h10.5v10H0z\"/></a><a xlink:href=\"#a\"><circle cx=\"5\" cy=\"5\" r=\"2\" fill=\"#fff\"/></a><image xlink:href=\"data:image/png;base64,AAAA\" width=\"1\" height=\"1\"/></svg>","<svg xmlns=\"http://www.w3.org/2000/svg\"><a><path id=\"r1\" d=\"M0 0h5v5H0z\" style=\"fill:red\"/></a><use href=\"#r1\"/></svg>"];

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
