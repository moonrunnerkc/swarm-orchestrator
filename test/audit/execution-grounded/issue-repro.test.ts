import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyComparison,
  classifyRepro,
  executeIssueRepro,
  extractCodeBlocks,
  extractRepros,
  parseIssueReferences,
} from '../../../src/audit/execution-grounded/issue-repro';

const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';

describe('execution-grounded / issue-repro (pure logic)', () => {
  describe('parseIssueReferences', () => {
    it('parses bare, slug, and URL closing references and dedupes', () => {
      const text = [
        'This PR fixes #123 and closes #123 (dup).',
        'Also resolves owner/repo#45.',
        'See: fixed https://github.com/acme/widgets/issues/7',
        'unrelated mention of #999 without a verb',
      ].join('\n');
      const refs = parseIssueReferences(text);
      assert.deepEqual(refs, [
        { owner: 'acme', repo: 'widgets', number: 7 },
        { owner: 'owner', repo: 'repo', number: 45 },
        { number: 123 },
      ]);
    });
    it('does not sweep up issue mentions without a closing verb', () => {
      assert.deepEqual(parseIssueReferences('related to #5, see #6'), []);
    });
  });

  describe('extractCodeBlocks', () => {
    it('extracts fenced blocks with their language tag', () => {
      const md = 'intro\n```ts\nconst x: number = 1;\n```\nmid\n```\nplain\n```\n';
      const blocks = extractCodeBlocks(md);
      assert.equal(blocks.length, 2);
      assert.equal(blocks[0]!.lang, 'ts');
      assert.equal(blocks[0]!.code, 'const x: number = 1;');
      assert.equal(blocks[1]!.lang, '');
    });
  });

  describe('classifyRepro', () => {
    it('classifies a test snippet', () => {
      const r = classifyRepro({ lang: 'js', code: "it('works', () => { expect(f()).toBe(1); });" });
      assert.equal(r?.kind, 'test');
      assert.equal(r?.language, 'js');
    });
    it('classifies a runnable script and sniffs TypeScript', () => {
      const r = classifyRepro({ lang: '', code: 'const n: number = compute();\nconsole.log(n);' });
      assert.equal(r?.kind, 'script');
      assert.equal(r?.language, 'ts');
    });
    it('rejects shell snippets and prose', () => {
      assert.equal(classifyRepro({ lang: 'bash', code: 'npm install' }), null);
      assert.equal(classifyRepro({ lang: '', code: 'just some words here' }), null);
    });
  });

  describe('extractRepros', () => {
    it('lifts only the runnable blocks from an issue body', () => {
      const body = [
        'Steps:',
        '```bash',
        'npm run build',
        '```',
        'Repro:',
        '```js',
        'const { f } = require("pkg");',
        'console.log(f());',
        '```',
      ].join('\n');
      const repros = extractRepros(body);
      assert.equal(repros.length, 1);
      assert.equal(repros[0]!.kind, 'script');
    });
  });

  describe('classifyComparison', () => {
    it('maps the pre/post matrix', () => {
      assert.equal(classifyComparison('failed', 'failed'), 'fix-not-delivered');
      assert.equal(classifyComparison('failed', 'passed'), 'fix-delivered');
      assert.equal(classifyComparison('passed', 'passed'), 'not-reproducible');
      assert.equal(classifyComparison('passed', 'failed'), 'pr-broke-repro');
      assert.equal(classifyComparison('timeout', 'failed'), 'unevaluable');
      assert.equal(classifyComparison('failed', 'errored'), 'unevaluable');
    });
  });

  (INTEGRATION ? describe : describe.skip)('executeIssueRepro (live)', function () {
    this.timeout(120_000);
    it('reports a passing script and a failing script by exit code', () => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-repro-it-'));
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
      try {
        const ok = executeIssueRepro({
          workspacePath: ws,
          repro: { kind: 'script', language: 'js', code: 'console.log("ok"); process.exit(0);' },
          testRunner: null,
        });
        assert.equal(ok.status, 'passed');
        const bad = executeIssueRepro({
          workspacePath: ws,
          repro: { kind: 'script', language: 'js', code: 'throw new Error("repro reproduces");' },
          testRunner: null,
        });
        assert.equal(bad.status, 'failed');
        assert.ok(/repro reproduces/.test(bad.stderr));
        assert.equal(fs.existsSync(path.join(ws, '__swarm_repro__.js')), false, 'temp file cleaned up');
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
    it('treats a non-parseable repro as errored (unevaluable), not a failing repro', () => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-repro-it-'));
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
      try {
        // A malformed extraction (invalid syntax) exits non-zero, but it never
        // ran the code under test, so it is unevaluable, not a failing repro.
        const bad = executeIssueRepro({
          workspacePath: ws,
          repro: { kind: 'script', language: 'js', code: 'const x = {.;' },
          testRunner: null,
        });
        assert.equal(bad.status, 'errored');
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });
});
