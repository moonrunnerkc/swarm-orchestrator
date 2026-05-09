import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverRepoContext,
} from '../src/contract/compiler';
import { isTestFilePath, renderDynamicMessage } from '../src/population/manager';
import { preVerifyObligations } from '../src/verification/pre-generation';

/**
 * Regression suite for the three quality fixes landed after the 2026-05-08
 * end-to-end demo run. Each `it` block fails on the pre-fix tree and
 * passes on the post-fix tree.
 *
 * Findings the tests cover:
 *
 *   F1 — implementer was given a `build-must-pass` obligation with no
 *        signal about why the build was failing, and produced an off-target
 *        diff that wrote a stray file at repo root. Fix: pre-run the
 *        verifier and embed the failure tail into the persona prompt so
 *        the diff is targeted at the actual error.
 *
 *   F2 — architect emitted Jest-shaped tests (`test()`/`expect()`) into a
 *        `node --test` project because the persona had no signal about
 *        which test framework was in scope. Fix: detect testFramework in
 *        `discoverRepoContext`, plumb it through the manifest, and embed
 *        a prescriptive framework hint in the dynamic prompt for any
 *        file-must-exist whose path looks like a test file.
 *
 *   F3 — pre-generation verification vacuously satisfied `test-must-pass`
 *        against an empty repo (`node --test` with no tests exits 0),
 *        which the post-merge check then had to flip to failed. Fix: pre-
 *        gen now defers global-state obligations (build/test/property/
 *        coverage/performance) until every local obligation is satisfied.
 */
describe('v8 quality fixes (post-2026-05-08 e2e regression suite)', () => {
  describe('F2 — architect sees the project test framework', () => {
    it('isTestFilePath identifies common test-file shapes', () => {
      assert.equal(isTestFilePath('src/hello.test.ts'), true);
      assert.equal(isTestFilePath('src/hello.spec.ts'), true);
      assert.equal(isTestFilePath('tests/__tests__/foo.ts'), true);
      assert.equal(isTestFilePath('test_foo.py'), false); // python test convention
      assert.equal(isTestFilePath('foo_test.py'), true);
      assert.equal(isTestFilePath('src/hello.ts'), false);
      assert.equal(isTestFilePath('CHANGELOG.md'), false);
    });

    it('discoverRepoContext detects node:test in package.json scripts', () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          scripts: { build: 'tsc', test: 'node --test' },
          devDependencies: { typescript: '^5.0.0' },
        }),
      );
      fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
      const ctx = discoverRepoContext(root);
      assert.equal(ctx.language, 'typescript');
      assert.equal(ctx.testFramework, 'node-test');
    });

    it('discoverRepoContext detects each major Node test framework', () => {
      assert.equal(detectFramework({ devDependencies: { jest: '^29' } }), 'jest');
      assert.equal(detectFramework({ devDependencies: { vitest: '^1' } }), 'vitest');
      assert.equal(detectFramework({ devDependencies: { mocha: '^10' } }), 'mocha');
      assert.equal(
        detectFramework({ scripts: { test: 'node --test' } }),
        'node-test',
      );
      assert.equal(detectFramework({}), null);
    });

    it('detects pytest from pyproject.toml or requirements.txt', () => {
      const root1 = mkTmp();
      fs.writeFileSync(path.join(root1, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
      assert.equal(discoverRepoContext(root1).testFramework, 'pytest');

      const root2 = mkTmp();
      fs.writeFileSync(path.join(root2, 'requirements.txt'), 'pytest==8.0.0\n');
      assert.equal(discoverRepoContext(root2).testFramework, 'pytest');
    });

    it('renderDynamicMessage embeds a node:test hint when testFramework=node-test', () => {
      const msg = renderDynamicMessage(
        { type: 'file-must-exist', path: 'src/hello.test.ts' },
        '/repo',
        { testFramework: 'node-test' },
      );
      assert.match(msg, /node:test/);
      assert.match(msg, /node:assert/);
      assert.match(msg, /do NOT use Jest/i);
    });

    it('renderDynamicMessage promotes the framework hint above the generic instructions', () => {
      // Sonnet historically ignored framework hints buried after the
      // base "emit a fenced block" line. Promoting the hint to the top
      // of the message and labelling it REQUIRED makes it structurally
      // salient. This test asserts the ordering directly.
      const msg = renderDynamicMessage(
        { type: 'file-must-exist', path: 'src/hello.test.ts' },
        '/repo',
        { testFramework: 'node-test' },
      );
      const requiredIdx = msg.indexOf('REQUIRED:');
      const emitIdx = msg.indexOf('Emit the file content');
      assert.notEqual(requiredIdx, -1, 'REQUIRED label must be present');
      assert.notEqual(emitIdx, -1, 'Emit instruction must be present');
      assert.ok(requiredIdx < emitIdx, 'REQUIRED block must precede the generic emit instruction');
    });

    it('renderDynamicMessage embeds a Jest hint when testFramework=jest', () => {
      const msg = renderDynamicMessage(
        { type: 'file-must-exist', path: 'src/hello.test.ts' },
        '/repo',
        { testFramework: 'jest' },
      );
      assert.match(msg, /Jest API/);
      assert.match(msg, /expect\(x\)\.toBe\(y\)/);
    });

    it('renderDynamicMessage stays silent on framework hint for non-test files', () => {
      const msg = renderDynamicMessage(
        { type: 'file-must-exist', path: 'src/hello.ts' },
        '/repo',
        { testFramework: 'node-test' },
      );
      assert.doesNotMatch(msg, /node:test/);
      assert.doesNotMatch(msg, /Jest/);
    });

    it('renderDynamicMessage stays silent on framework hint when no framework detected', () => {
      const msg = renderDynamicMessage(
        { type: 'file-must-exist', path: 'src/hello.test.ts' },
        '/repo',
        { testFramework: null },
      );
      assert.doesNotMatch(msg, /node:test/);
      assert.doesNotMatch(msg, /Jest/);
      // Still says "test file" though? No: with framework=null we say
      // nothing about frameworks at all. The prompt falls back to the
      // base file-must-exist instructions only.
      assert.doesNotMatch(msg, /test file/);
    });
  });

  describe('F1 — implementer/verifier sees the actual command failure', () => {
    it('renderDynamicMessage embeds command failure tail for build-must-pass', () => {
      const tail = "src/foo.ts(3,1): error TS2304: Cannot find name 'expect'.";
      const msg = renderDynamicMessage(
        { type: 'build-must-pass', command: 'npm run build' },
        '/repo',
        { commandFailureTail: tail },
      );
      assert.match(msg, /verifier ran `npm run build`/);
      assert.match(msg, /Cannot find name 'expect'/);
      assert.match(msg, /smallest diff that fixes the root cause/);
      assert.match(msg, /Do not write speculative files/);
    });

    it('renderDynamicMessage embeds command failure tail for test-must-pass', () => {
      const msg = renderDynamicMessage(
        { type: 'test-must-pass', command: 'npm test' },
        '/repo',
        { commandFailureTail: 'AssertionError: expected 1 to equal 2' },
      );
      assert.match(msg, /verifier ran `npm test`/);
      assert.match(msg, /AssertionError/);
    });

    it('renderDynamicMessage embeds path-discipline guard rails for diff obligations', () => {
      // Without this, the implementer historically wrote a `+++ hello.ts`
      // header (no `b/` prefix) that landed at repo root because
      // stripPathPrefix only trims `a/` and `b/`. The prompt now tells
      // the persona to use `--- a/path` / `+++ b/path` and forbids
      // writing outside obligation-required paths.
      const msg = renderDynamicMessage(
        { type: 'build-must-pass', command: 'npm run build' },
        '/repo',
      );
      assert.match(msg, /repo-relative paths in diff headers/);
      assert.match(msg, /never write outside existing files/);
    });

    it('renderDynamicMessage adds a framework-preservation hint to test-must-pass', () => {
      // Without this, the verifier would routinely rewrite the
      // architect's correctly-framed test files into Jest API
      // (re-introducing the F2 problem at a different persona).
      const msg = renderDynamicMessage(
        { type: 'test-must-pass', command: 'npm test' },
        '/repo',
        { testFramework: 'node-test' },
      );
      assert.match(msg, /node-test/);
      assert.match(msg, /Preserve it/);
      assert.match(msg, /Do not switch test frameworks/);
    });

    it('renderDynamicMessage adds a framework-preservation hint to build-must-pass', () => {
      const msg = renderDynamicMessage(
        { type: 'build-must-pass', command: 'npm run build' },
        '/repo',
        { testFramework: 'jest' },
      );
      assert.match(msg, /jest/);
      assert.match(msg, /Preserve it/);
    });

    it('renderDynamicMessage stays silent on failure-tail when none provided', () => {
      const msg = renderDynamicMessage(
        { type: 'build-must-pass', command: 'npm run build' },
        '/repo',
      );
      assert.doesNotMatch(msg, /verifier ran/);
      assert.doesNotMatch(msg, /Tail of stderr/);
    });

    it('renderDynamicMessage truncates very long failure tails to a budget', () => {
      const tail = 'X'.repeat(5000);
      const msg = renderDynamicMessage(
        { type: 'build-must-pass', command: 'npm run build' },
        '/repo',
        { commandFailureTail: tail },
      );
      // The tail is capped at 2000 chars.
      const xs = msg.match(/X+/g)?.[0]?.length ?? 0;
      assert.equal(xs, 2000);
    });
  });

  describe('F2 defense-in-depth — post-write framework misuse is caught at the per-obligation verifier', () => {
    // Integration-shaped: drive the population manager against a stub
    // session that emits a Jest-shaped test file into a node:test
    // project. Without the defense-in-depth check, file-must-exist
    // passes (the file exists) and the failure surfaces only at
    // post-merge with a noisy stack trace. With the check, the
    // obligation fails immediately with a precise, persona-attributable
    // message.
    const { JsonlLedger } = require('../src/ledger/jsonl-ledger');
    const { createDefaultRegistry } = require('../src/persona/persona-registry');
    const { runPopulation } = require('../src/population/manager');

    type StubSession = {
      complete: (req: unknown) => Promise<{
        text: string;
        usage: { inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; outputTokens: number };
        model: string;
      }>;
    };

    function jestShapedSession(): StubSession {
      return {
        complete: async () => ({
          text:
            "import { hello } from './hello';\n\n" +
            "test('hello returns hello, world', () => {\n" +
            "  expect(hello()).toBe('hello, world');\n" +
            "});\n",
          usage: {
            inputTokens: 100,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            outputTokens: 50,
          },
          model: 'stub',
        }),
      };
    }

    it('rejects a Jest-shaped test file written into a node:test project', async () => {
      const root = mkTmp();
      const ledgerPath = path.join(root, 'ledger.jsonl');
      const ledger = new JsonlLedger(ledgerPath, 'r-test');
      const registry = createDefaultRegistry();
      const result = await runPopulation({
        contract: {
          manifest: {
            schemaVersion: 'v1',
            contractHash: 'x'.repeat(64),
            contractId: 'x'.repeat(16),
            goal: 'fixture',
            repoContext: {
              repoRoot: root,
              buildCommand: null,
              testCommand: 'node --test',
              language: 'typescript',
              testFramework: 'node-test',
            },
            extractor: {
              name: 'stub',
              model: null,
              temperature: null,
              promptSha256: null,
            },
            createdAt: new Date().toISOString(),
          },
          obligations: [{ type: 'file-must-exist', path: 'hello.test.ts' }],
        },
        repoRoot: root,
        registry,
        session: jestShapedSession(),
        ledger,
      });
      assert.equal(result.satisfied, 0);
      assert.equal(result.failed, 1);
      const detail = result.outcomes[0]?.detail ?? '';
      assert.match(detail, /wrong test framework/);
      assert.match(detail, /Jest-style/);
      assert.match(detail, /node-test/);
    });

    it('accepts a node:test-shaped test file written into a node:test project', async () => {
      const root = mkTmp();
      const ledgerPath = path.join(root, 'ledger.jsonl');
      const ledger = new JsonlLedger(ledgerPath, 'r-ok');
      const registry = createDefaultRegistry();
      const session: StubSession = {
        complete: async () => ({
          text:
            "import { describe, it } from 'node:test';\n" +
            "import assert from 'node:assert/strict';\n" +
            "import { hello } from './hello.js';\n\n" +
            "describe('hello', () => {\n" +
            "  it('returns hello, world', () => {\n" +
            "    assert.equal(hello(), 'hello, world');\n" +
            "  });\n" +
            "});\n",
          usage: {
            inputTokens: 100,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            outputTokens: 50,
          },
          model: 'stub',
        }),
      };
      const result = await runPopulation({
        contract: {
          manifest: {
            schemaVersion: 'v1',
            contractHash: 'x'.repeat(64),
            contractId: 'x'.repeat(16),
            goal: 'fixture',
            repoContext: {
              repoRoot: root,
              buildCommand: null,
              testCommand: 'node --test',
              language: 'typescript',
              testFramework: 'node-test',
            },
            extractor: {
              name: 'stub',
              model: null,
              temperature: null,
              promptSha256: null,
            },
            createdAt: new Date().toISOString(),
          },
          obligations: [{ type: 'file-must-exist', path: 'hello.test.ts' }],
        },
        repoRoot: root,
        registry,
        session,
        ledger,
      });
      assert.equal(result.satisfied, 1);
      assert.equal(result.failed, 0);
    });
  });

  describe('F3 — pre-gen does not vacuously satisfy global-state obligations', () => {
    it('global obligations stay pending while local obligations are unsatisfied', () => {
      const root = mkTmp();
      // node --test against an empty repo exits 0 — exactly the vacuous
      // pass that historically misled the manager into recording
      // test-must-pass as already satisfied.
      const r = preVerifyObligations({
        obligations: [
          { type: 'file-must-exist', path: 'src/hello.test.ts' }, // pending
          { type: 'test-must-pass', command: 'true' }, // would vacuously pass
        ],
        verifyOptions: { repoRoot: root },
      });
      // The local obligation got checked (pass 1). The global obligation
      // did NOT get checked because the local is still pending.
      assert.equal(r.checks.length, 1);
      assert.equal(r.checks[0]?.obligation.type, 'file-must-exist');
      assert.equal(r.satisfiedIndexes.size, 0);
    });

    it('global obligations pre-verify once every local obligation passes', () => {
      const root = mkTmp();
      fs.writeFileSync(path.join(root, 'src.ts'), '// ok');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'a.ts'), '// ok');
      const r = preVerifyObligations({
        obligations: [
          { type: 'file-must-exist', path: 'src.ts' },
          { type: 'build-must-pass', command: 'true' },
        ],
        verifyOptions: { repoRoot: root },
      });
      assert.equal(r.checks.length, 2);
      assert.deepEqual([...r.satisfiedIndexes].sort((a, b) => a - b), [0, 1]);
    });
  });
});

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-quality-fix-'));
}

interface PkgShape {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function detectFramework(pkg: PkgShape): string | null {
  const root = mkTmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  return discoverRepoContext(root).testFramework ?? null;
}
