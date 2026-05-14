#!/usr/bin/env node
// Phase 2a parity check: apply each diff in test/fixtures/sample-diffs/ to a
// synthetic src/example.ts, sha256 the post-apply contents, print one
// "<fixture>\t<hash>" line per fixture. Output must be byte-identical between
// the pre-cut and post-cut builds.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { applyUnifiedDiff } = require('../dist/src/population/unified-diff');

const FIXTURE_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'sample-diffs');
const SOURCE = [
  'export const first = 1;',
  'export const second = 3;',
  'export const third = 4;',
  'export const four = 4;',
  'export const five = 5;',
  'export const six = 6;',
  'export const seven = 7;',
  'export const eight = 8;',
  'export const nine = 9;',
  'export const oldValue = 10;',
  '',
].join('\n');

const fixtures = fs.readdirSync(FIXTURE_DIR).filter((n) => n.endsWith('.diff')).sort();
const results = [];
for (const name of fixtures) {
  const diff = fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fuzz-ud-'));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'example.ts'), SOURCE);
  let outcome;
  try {
    const r = applyUnifiedDiff(repo, diff);
    const file = path.join(repo, 'src', 'example.ts');
    const after = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '<deleted>';
    const hash = crypto.createHash('sha256').update(after).digest('hex');
    outcome = `applied=${r.applied}\tchanged=${r.changedFiles.join(',')}\thash=${hash}`;
  } catch (e) {
    outcome = `error=${e.message}`;
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
  results.push(`${name}\t${outcome}`);
}

// Synthetic edge cases — exercise parser branches not in the on-disk fixtures.
const repoCases = [
  {
    name: 'create-via-dev-null',
    pre: {},
    diff: ['--- /dev/null', '+++ b/created.txt', '@@ -0,0 +1,2 @@', '+a', '+b'].join('\n'),
    inspect: 'created.txt',
  },
  {
    name: 'delete-via-dev-null',
    pre: { 'goodbye.txt': 'bye\n' },
    diff: ['--- a/goodbye.txt', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-bye'].join('\n'),
    inspect: 'goodbye.txt',
  },
  {
    name: 'modify-multi-hunk',
    pre: {
      'x.txt': 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n',
    },
    diff: [
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1,2 +1,2 @@',
      '-one',
      '+ONE',
      ' two',
      '@@ -9,2 +9,2 @@',
      ' nine',
      '-ten',
      '+TEN',
    ].join('\n'),
    inspect: 'x.txt',
  },
  {
    name: 'multi-file-create',
    pre: {},
    diff: [
      '--- /dev/null',
      '+++ b/a.txt',
      '@@ -0,0 +1,1 @@',
      '+a',
      '--- /dev/null',
      '+++ b/b.txt',
      '@@ -0,0 +1,1 @@',
      '+b',
    ].join('\n'),
    inspect: 'a.txt,b.txt',
  },
  {
    name: 'fenced-diff',
    pre: {},
    diff: [
      '```diff',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,1 @@',
      '+hello',
      '```',
    ].join('\n'),
    inspect: 'new.txt',
  },
  {
    name: 'prose-preamble',
    pre: {},
    diff: ['Here is the patch:', '', '--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1,1 @@', '+hello'].join('\n'),
    inspect: 'new.txt',
  },
];

for (const c of repoCases) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fuzz-ud-'));
  for (const [rel, body] of Object.entries(c.pre)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  let outcome;
  try {
    const r = applyUnifiedDiff(repo, c.diff);
    const hashes = c.inspect.split(',').map((rel) => {
      const abs = path.join(repo, rel);
      const after = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '<deleted>';
      return `${rel}:${crypto.createHash('sha256').update(after).digest('hex')}`;
    });
    outcome = `applied=${r.applied}\tchanged=${r.changedFiles.sort().join(',')}\t${hashes.join('|')}`;
  } catch (e) {
    outcome = `error=${e.message}`;
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
  results.push(`SYNTH:${c.name}\t${outcome}`);
}

process.stdout.write(results.join('\n') + '\n');
