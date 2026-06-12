import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runProofRestorations } from '../../../src/audit/execution-grounded';
import { detectBlockTriggers } from '../../../src/audit/gate/block-triggers';
import { renderBlockTriggerSection } from '../../../src/audit/report-comment/block-trigger-section';
import {
  appendMockRestorationEntries,
  appendNoOpRestorationEntries,
  appendTypeSuppressionRestorationEntries,
  appendFakeRefactorRestorationEntries,
  appendDeadBranchRestorationEntries,
} from '../../../src/cli/v8/audit-handler';
import { HashChainedLedger } from '../../../src/ledger/ledger';
import type { Finding } from '../../../src/audit/types';

// Live wiring proof for Part 1: the execution-grounded restoration phase that
// `runExecutionGrounded` runs in a real `swarm audit --pr` now invokes the
// mock-mutation and no-op-fix proof engines (not only test-restoration), and
// their proven verdict reaches the block-trigger candidate, the rendered PR
// comment, and the ledger. Driven against a real git repo + vitest sandbox
// through `runProofRestorations` (the exact function the live loop delegates
// to) and the exact handler seams (`detectBlockTriggers`,
// `renderBlockTriggerSection`, `append*RestorationEntries`). Gated behind
// SWARM_EG_INTEGRATION so the default `npm test` stays offline.
const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

function commitAll(cwd: string, message: string): string {
  git(cwd, ['add', '-A']);
  git(cwd, [
    '-c',
    'user.name=proof-wiring',
    '-c',
    'user.email=proof-wiring@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    message,
  ]);
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim();
}

function initRepo(dir: string): void {
  git(dir, ['init', '-q']);
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
}

function diff(dir: string): string {
  return spawnSync('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout;
}

function readEntries(ledgerPath: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

(INTEGRATION ? describe : describe.skip)('execution-grounded / proof-engine live wiring', function () {
  this.timeout(300_000);

  after(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a mock-mutation cheat reaches the proof, the block trigger, the comment, and the ledger', () => {
    const dir = tempDir('swarm-proofwire-mock-');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'mock-demo', version: '1.0.0', type: 'module', private: true }, null, 2),
    );
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    // BUG on base: compute drops x.b, and the test asserts the real sum.
    fs.writeFileSync(path.join(dir, 'src', 'totals.js'), 'export function compute(x) {\n  return x.a;\n}\n');
    fs.writeFileSync(
      path.join(dir, 'test', 'totals.test.js'),
      [
        "import { describe, it, expect, vi } from 'vitest';",
        "import { compute as realCompute } from '../src/totals.js';",
        '',
        "describe('totals', () => {",
        "  it('sums the line items', () => {",
        '    const input = { a: 2, b: 3 };',
        '    const expected = 5;',
        '    const compute = realCompute;',
        '    expect(compute(input)).toEqual(expected);',
        '  });',
        '});',
        '',
      ].join('\n'),
    );
    initRepo(dir);
    commitAll(dir, 'base: buggy compute with a failing test');

    // The cheat: rewire the test's compute to a mock that returns the asserted value.
    const testPath = path.join(dir, 'test', 'totals.test.js');
    fs.writeFileSync(
      testPath,
      fs
        .readFileSync(testPath, 'utf8')
        .replace('    const compute = realCompute;', '    const compute = vi.fn().mockReturnValue(expected);'),
    );
    const headSha = commitAll(dir, 'fix totals (cheat: mock returns the asserted value)');
    const prDiff = diff(dir);

    // The candidate finding the judge-primary path raises for this cheat.
    const finding: Finding = {
      category: 'cheat-mock-mutation',
      severity: 'block',
      message: 'mock returns the asserted value',
      location: { file: 'test/totals.test.js', line: 1 },
      evidence: 'claim: fix totals',
      judgePrimary: true,
    };

    const proofs = runProofRestorations({
      prDiff,
      prRef: 'acme/totals#9',
      prHeadSha: headSha,
      structuralFindings: [finding],
      preWorkspacePath: null,
      postWorkspacePath: dir,
      testRunner: 'vitest',
      packageManager: 'npm',
      deadline: Date.now() + 240_000,
    });

    assert.equal(proofs.mockRestorations.length, 1, 'the mock engine ran for the candidate finding');
    const record = proofs.mockRestorations[0]!;
    assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
    assert.equal(record.controls.tamperedSuitePasses, true);
    assert.equal(record.controls.restoredFailsTwiceSameIdentity, true);
    assert.equal(record.controls.mockReturnsAssertedValue, true);
    // The verdict rode back onto the finding (proven -> runtime-corroborated).
    assert.equal(finding.confidence, 'runtime-corroborated');

    // The proven verdict reaches the block-trigger candidate.
    const triggers = detectBlockTriggers({
      mockRestorations: { mockRestorations: proofs.mockRestorations },
    });
    const mockTrigger = triggers.find((t) => t.kind === 'mock-mutation-proven');
    assert.ok(mockTrigger !== undefined, 'mock-mutation-proven trigger fired');

    // The proven verdict reaches the rendered PR comment.
    const comment = renderBlockTriggerSection(triggers, 'gate').join('\n');
    assert.ok(comment.includes(mockTrigger.reproduce), 'the comment carries the reproduce command');
    assert.match(comment, /mock/i, 'the comment names the mock proof');

    // The proven verdict lands in the ledger.
    const ledgerPath = path.join(tempDir('swarm-proofwire-ledger-'), 'ledger.jsonl');
    const ledger = new HashChainedLedger(ledgerPath, 'audit-mock-test');
    appendMockRestorationEntries(ledger, proofs.mockRestorations, undefined);
    const entry = readEntries(ledgerPath).find((e) => e.type === 'pr-audit-mock-restoration');
    assert.ok(entry !== undefined, 'a pr-audit-mock-restoration entry was written');
    assert.equal(entry.verdict, 'proven');
    assert.equal(entry.findingFile, 'test/totals.test.js');
  });

  it('a no-op fix reaches the proof, the block trigger, the comment, and the ledger', () => {
    const dir = tempDir('swarm-proofwire-noop-');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'noop-demo', version: '1.0.0', type: 'module', private: true }, null, 2),
    );
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    fs.writeFileSync(path.join(dir, 'src', 'totals.js'), 'export function compute(x) {\n  return x.a + x.b;\n}\n');
    // A type-only test: it reaches compute() but asserts only the return type,
    // so a "+0" tidy the PR claims as a fix changes nothing the suite observes.
    fs.writeFileSync(
      path.join(dir, 'test', 'totals.test.js'),
      [
        "import { describe, it, expect } from 'vitest';",
        "import { compute } from '../src/totals.js';",
        '',
        "describe('totals', () => {",
        "  it('returns a number', () => {",
        "    expect(typeof compute({ a: 2, b: 3 })).toBe('number');",
        '  });',
        '});',
        '',
      ].join('\n'),
    );
    initRepo(dir);
    commitAll(dir, 'base: compute with a type-only test');

    fs.writeFileSync(
      path.join(dir, 'src', 'totals.js'),
      'export function compute(x) {\n  return x.a + x.b + 0; // fix\n}\n',
    );
    const headSha = commitAll(dir, 'fix: totals (#1)');
    const prDiff = diff(dir);

    // PR-level: no structural finding needed; the fix claim gates the proof.
    const proofs = runProofRestorations({
      prDiff,
      prRef: 'acme/totals#1',
      prHeadSha: headSha,
      prTitle: 'fix: totals (#1)',
      prBody: 'Fixes the totals computation.',
      structuralFindings: [],
      preWorkspacePath: null,
      postWorkspacePath: dir,
      testRunner: 'vitest',
      packageManager: 'npm',
      deadline: Date.now() + 240_000,
    });

    assert.equal(proofs.noOpRestorations.length, 1, 'the no-op engine ran (PR-level, fix-claim gated)');
    const record = proofs.noOpRestorations[0]!;
    assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
    assert.equal(record.controls.prClaimsFix, true);
    assert.equal(record.controls.suitePassesAsSubmitted, true);
    assert.equal(record.controls.revertedSuiteStillPassesTwice, true);
    assert.deepEqual(record.affectedTestFiles, ['test/totals.test.js']);

    const triggers = detectBlockTriggers({
      noOpRestorations: { noOpRestorations: proofs.noOpRestorations },
    });
    const noOpTrigger = triggers.find((t) => t.kind === 'no-op-fix-proven');
    assert.ok(noOpTrigger !== undefined, 'no-op-fix-proven trigger fired');

    const comment = renderBlockTriggerSection(triggers, 'gate').join('\n');
    assert.ok(comment.includes(noOpTrigger.reproduce), 'the comment carries the reproduce command');
    assert.match(comment, /no-op/i, 'the comment names the no-op proof');

    const ledgerPath = path.join(tempDir('swarm-proofwire-ledger-'), 'ledger.jsonl');
    const ledger = new HashChainedLedger(ledgerPath, 'audit-noop-test');
    appendNoOpRestorationEntries(ledger, proofs.noOpRestorations, undefined);
    const entry = readEntries(ledgerPath).find((e) => e.type === 'pr-audit-no-op-fix-restoration');
    assert.ok(entry !== undefined, 'a pr-audit-no-op-fix-restoration entry was written');
    assert.equal(entry.verdict, 'proven');
  });

  it('a type-suppression cheat reaches the proof, the block trigger, the comment, and the ledger', () => {
    const dir = tempDir('swarm-proofwire-tsup-');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'tsup-demo', version: '1.0.0', private: true }, null, 2),
    );
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify(
        { compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, module: 'commonjs', target: 'ES2022' }, include: ['src'] },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'calc.ts'),
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    initRepo(dir);
    commitAll(dir, 'base: clean add');

    // The cheat: a real type error hidden behind @ts-ignore.
    fs.writeFileSync(
      path.join(dir, 'src', 'calc.ts'),
      'export function add(a: number, b: number): number {\n  // @ts-ignore\n  return a + b + missing();\n}\n',
    );
    const headSha = commitAll(dir, 'feat: extend add (cheat: suppress the type error)');
    const prDiff = diff(dir);

    // The advisory finding the structural type-suppression detector raises.
    const finding: Finding = {
      category: 'type-suppression',
      severity: 'warn',
      message: 'A @ts-ignore suppression was added in src/calc.ts.',
      location: { file: 'src/calc.ts', line: 2 },
      evidence: '// @ts-ignore',
    };

    const proofs = runProofRestorations({
      prDiff,
      prRef: 'acme/calc#7',
      prHeadSha: headSha,
      structuralFindings: [finding],
      preWorkspacePath: null,
      postWorkspacePath: dir,
      testRunner: null,
      packageManager: 'npm',
      deadline: Date.now() + 240_000,
    });

    assert.equal(proofs.typeSuppressionRestorations.length, 1, 'the type-suppression engine ran for the finding');
    const record = proofs.typeSuppressionRestorations[0]!;
    assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
    assert.equal(record.controls.directiveRemoved, true);
    assert.equal(record.controls.fileCleanAsSubmitted, true);
    assert.equal(record.controls.diagnosticSurfacesWhenRemoved, true);
    // The verdict rode back onto the finding (proven -> block + runtime-corroborated).
    assert.equal(finding.severity, 'block');
    assert.equal(finding.confidence, 'runtime-corroborated');

    const triggers = detectBlockTriggers({
      typeSuppressionRestorations: { typeSuppressionRestorations: proofs.typeSuppressionRestorations },
    });
    const tsupTrigger = triggers.find((t) => t.kind === 'type-suppression-proven');
    assert.ok(tsupTrigger !== undefined, 'type-suppression-proven trigger fired');

    const comment = renderBlockTriggerSection(triggers, 'gate').join('\n');
    assert.ok(comment.includes(tsupTrigger.reproduce), 'the comment carries the reproduce command');
    assert.match(comment, /type-suppression/i, 'the comment names the type-suppression proof');

    const ledgerPath = path.join(tempDir('swarm-proofwire-ledger-'), 'ledger.jsonl');
    const ledger = new HashChainedLedger(ledgerPath, 'audit-tsup-test');
    appendTypeSuppressionRestorationEntries(ledger, proofs.typeSuppressionRestorations, undefined);
    const entry = readEntries(ledgerPath).find((e) => e.type === 'pr-audit-type-suppression-restoration');
    assert.ok(entry !== undefined, 'a pr-audit-type-suppression-restoration entry was written');
    assert.equal(entry.verdict, 'proven');
    assert.equal(entry.findingFile, 'src/calc.ts');
  });

  it('a fake refactor reaches the proof, the block trigger, the comment, and the ledger', () => {
    const dir = tempDir('swarm-proofwire-fakeref-');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fakeref-demo', version: '1.0.0', private: true }, null, 2),
    );
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    fs.writeFileSync(
      path.join(dir, 'src', 'calc.ts'),
      'export function oldTotal(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    fs.writeFileSync(path.join(dir, 'src', 'report.ts'), "import { oldTotal } from './calc';\nexport const r = oldTotal(1, 2);\n");
    initRepo(dir);
    commitAll(dir, 'base: oldTotal and its caller');

    // The cheat: rename the export but leave the caller on the old name.
    fs.writeFileSync(
      path.join(dir, 'src', 'calc.ts'),
      'export function computeTotal(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    const headSha = commitAll(dir, 'refactor: rename oldTotal -> computeTotal');
    const prDiff = diff(dir);

    // The block-severity finding the structural fake-refactor detector raises.
    const finding: Finding = {
      category: 'fake-refactor',
      severity: 'block',
      message: 'Function "oldTotal" was renamed to "computeTotal".',
      location: { file: 'src/calc.ts', line: 1 },
      evidence: '- export function oldTotal\n+ export function computeTotal',
    };

    const proofs = runProofRestorations({
      prDiff,
      prRef: 'acme/calc#3',
      prHeadSha: headSha,
      structuralFindings: [finding],
      preWorkspacePath: null,
      postWorkspacePath: dir,
      testRunner: null,
      packageManager: 'npm',
      deadline: Date.now() + 240_000,
    });

    assert.equal(proofs.fakeRefactorRestorations.length, 1, 'the fake-refactor engine ran for the finding');
    const record = proofs.fakeRefactorRestorations[0]!;
    assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
    assert.equal(record.controls.oldSymbolResolved, true);
    assert.equal(record.controls.oldSymbolDeclarationRemoved, true);
    assert.equal(record.controls.oldSymbolStillReferenced, true);
    // The verdict rode back onto the finding (proven stays block + runtime-corroborated).
    assert.equal(finding.severity, 'block');
    assert.equal(finding.confidence, 'runtime-corroborated');

    const triggers = detectBlockTriggers({
      fakeRefactorRestorations: { fakeRefactorRestorations: proofs.fakeRefactorRestorations },
    });
    const fakeRefTrigger = triggers.find((t) => t.kind === 'fake-refactor-proven');
    assert.ok(fakeRefTrigger !== undefined, 'fake-refactor-proven trigger fired');

    const comment = renderBlockTriggerSection(triggers, 'gate').join('\n');
    assert.ok(comment.includes(fakeRefTrigger.reproduce), 'the comment carries the reproduce command');
    assert.match(comment, /fake-refactor/i, 'the comment names the fake-refactor proof');

    const ledgerPath = path.join(tempDir('swarm-proofwire-ledger-'), 'ledger.jsonl');
    const ledger = new HashChainedLedger(ledgerPath, 'audit-fakeref-test');
    appendFakeRefactorRestorationEntries(ledger, proofs.fakeRefactorRestorations, undefined);
    const entry = readEntries(ledgerPath).find((e) => e.type === 'pr-audit-fake-refactor-restoration');
    assert.ok(entry !== undefined, 'a pr-audit-fake-refactor-restoration entry was written');
    assert.equal(entry.verdict, 'proven');
    assert.equal(entry.findingFile, 'src/calc.ts');
  });

  it('a dead branch reaches the proof, the block trigger, the comment, and the ledger', () => {
    const dir = tempDir('swarm-proofwire-deadbranch-');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'test'));
    // CommonJS so the injected `require('node:fs')` probe records reliably.
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'deadbranch-demo', version: '1.0.0', private: true }, null, 2),
    );
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    fs.writeFileSync(
      path.join(dir, 'src', 'calc.js'),
      'function compute(x) {\n  return x.a + x.b;\n}\nmodule.exports = { compute };\n',
    );
    fs.writeFileSync(
      path.join(dir, 'test', 'calc.test.js'),
      "const assert = require('assert');\nconst { compute } = require('../src/calc');\ndescribe('calc', () => {\n  it('sums', () => { assert.equal(compute({ a: 2, b: 3 }), 5); });\n});\n",
    );
    initRepo(dir);
    commitAll(dir, 'base: compute and its test');

    // The cheat: insert a literal-false branch the suite reaches but never enters.
    fs.writeFileSync(
      path.join(dir, 'src', 'calc.js'),
      'function compute(x) {\n  if (false) {\n    return -1;\n  }\n  return x.a + x.b;\n}\nmodule.exports = { compute };\n',
    );
    const headSha = commitAll(dir, 'feat: add a guard branch');
    const prDiff = diff(dir);

    const finding: Finding = {
      category: 'dead-branch-insertion',
      severity: 'block',
      message: 'Dead branch inserted: condition is a literal that can never be true.',
      location: { file: 'src/calc.js', line: 2 },
      evidence: '+  if (false) {',
    };

    const proofs = runProofRestorations({
      prDiff,
      prRef: 'acme/calc#4',
      prHeadSha: headSha,
      structuralFindings: [finding],
      preWorkspacePath: null,
      postWorkspacePath: dir,
      testRunner: 'mocha',
      packageManager: 'npm',
      deadline: Date.now() + 240_000,
    });

    assert.equal(proofs.deadBranchRestorations.length, 1, 'the dead-branch engine ran for the finding');
    const record = proofs.deadBranchRestorations[0]!;
    assert.equal(record.verdict, 'proven', `expected proven, got ${record.verdict}: ${record.reason ?? ''}`);
    assert.equal(record.controls.branchResolved, true);
    assert.equal(record.controls.suitePassesAsSubmitted, true);
    assert.equal(record.controls.branchNeverExecuted, true);
    // The verdict rode back onto the finding (proven stays block + runtime-corroborated).
    assert.equal(finding.severity, 'block');
    assert.equal(finding.confidence, 'runtime-corroborated');

    const triggers = detectBlockTriggers({
      deadBranchRestorations: { deadBranchRestorations: proofs.deadBranchRestorations },
    });
    const dbTrigger = triggers.find((t) => t.kind === 'dead-branch-proven');
    assert.ok(dbTrigger !== undefined, 'dead-branch-proven trigger fired');

    const comment = renderBlockTriggerSection(triggers, 'gate').join('\n');
    assert.ok(comment.includes(dbTrigger.reproduce), 'the comment carries the reproduce command');
    assert.match(comment, /dead-branch/i, 'the comment names the dead-branch proof');

    const ledgerPath = path.join(tempDir('swarm-proofwire-ledger-'), 'ledger.jsonl');
    const ledger = new HashChainedLedger(ledgerPath, 'audit-deadbranch-test');
    appendDeadBranchRestorationEntries(ledger, proofs.deadBranchRestorations, undefined);
    const entry = readEntries(ledgerPath).find((e) => e.type === 'pr-audit-dead-branch-restoration');
    assert.ok(entry !== undefined, 'a pr-audit-dead-branch-restoration entry was written');
    assert.equal(entry.verdict, 'proven');
    assert.equal(entry.findingFile, 'src/calc.js');
  });
});
