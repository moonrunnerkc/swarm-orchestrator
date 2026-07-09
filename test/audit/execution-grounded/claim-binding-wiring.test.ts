import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractTestTitles,
  gatherExistingTests,
} from '../../../src/audit/execution-grounded/claim-binding-candidates';
import { claimBindingFindings } from '../../../src/audit/execution-grounded';
import type { ClaimBindingResult } from '../../../src/audit/execution-grounded/claim-binding';

// Wiring of the Tier C claim-binding engine: the deterministic existing-test
// candidate gathering (what the wiring supplies to the binder) and the advisory
// finding mapping. The binder's own soundness is measured by
// `claim-binding:measure`; this pins the wiring, not the proof.

const tempDirs: string[] = [];

function workspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cb-wiring-'));
  tempDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('claim-binding-candidates / extractTestTitles', () => {
  it('extracts JS/TS it/test/describe titles', () => {
    const src = "describe('calc', () => { it('adds two numbers', () => {}); test('subtracts', () => {}); });";
    assert.deepEqual(extractTestTitles(src), ['calc', 'adds two numbers', 'subtracts']);
  });

  it('extracts Python def test_ names', () => {
    assert.deepEqual(extractTestTitles('def test_add():\n    pass\ndef test_sub():\n    pass\n'), [
      'test_add',
      'test_sub',
    ]);
  });

  it('extracts Go func TestXxx names', () => {
    assert.deepEqual(extractTestTitles('func TestAdd(t *testing.T) {}\nfunc TestSub(t *testing.T) {}'), [
      'TestAdd',
      'TestSub',
    ]);
  });

  it('returns [] when no test title is present', () => {
    assert.deepEqual(extractTestTitles('const x = 1;'), []);
  });
});

describe('claim-binding-candidates / gatherExistingTests', () => {
  it('returns [] when the diff changes no non-test source', () => {
    const dir = workspace({ 'src/calc.ts': 'export const add = (a: number, b: number) => a + b;\n' });
    assert.deepEqual(gatherExistingTests({ prDiff: '', postWorkspacePath: dir }), []);
  });

  it('binds a repo test whose closure reaches the changed source, with symbols', () => {
    const dir = workspace({
      'src/calc.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
      'calc.test.ts': "import { add } from './src/calc';\nit('adds two numbers', () => { add(1, 2); });\n",
    });
    const prDiff = [
      'diff --git a/src/calc.ts b/src/calc.ts',
      'index 111..222 100644',
      '--- a/src/calc.ts',
      '+++ b/src/calc.ts',
      '@@ -1,3 +1,3 @@',
      ' export function add(a: number, b: number): number {',
      '-  return a + b;',
      '+  return a - b;',
      ' }',
      '',
    ].join('\n');
    const candidates = gatherExistingTests({ prDiff, postWorkspacePath: dir });
    assert.equal(candidates.length, 1, 'one candidate for the one covering test title');
    assert.equal(candidates[0]?.file, 'calc.test.ts');
    assert.equal(candidates[0]?.testName, 'adds two numbers');
    // referencedSymbols carry the changed file's basename and its exported symbol.
    assert.ok(candidates[0]?.referencedSymbols.includes('calc'), 'basename symbol present');
    assert.ok(candidates[0]?.referencedSymbols.includes('add'), 'exported symbol present');
  });
});

describe('execution-grounded / claimBindingFindings', () => {
  function result(verdict: ClaimBindingResult['verdict']): ClaimBindingResult {
    return {
      verdict,
      isFinding: verdict === 'claim-falsified-bound',
      reason: 'test reason',
      binding: {
        test: { file: 'calc.test.ts', testName: 'adds two numbers', referencedSymbols: ['add'] },
        score: 7,
        signals: ['claim names referenced symbol add'],
      },
      identity: 'calc › adds two numbers',
      baseRuns: 3,
      headRuns: 3,
      passCapability: { kind: 'honest-twin-pass', established: true, detail: 'green' },
    };
  }

  it('maps claim-falsified-bound to an advisory warn finding', () => {
    const findings = claimBindingFindings(result('claim-falsified-bound'), 'owner/repo#1');
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.category, 'claim-falsified-bound');
    assert.equal(findings[0]?.severity, 'warn');
    assert.equal(findings[0]?.location.file, 'calc.test.ts');
  });

  it('produces no finding for a delivered claim or an abstain', () => {
    assert.deepEqual(claimBindingFindings(result('claim-delivered'), 'owner/repo#1'), []);
    assert.deepEqual(claimBindingFindings(result('abstain:no-pass-capability-evidence'), 'owner/repo#1'), []);
  });
});
