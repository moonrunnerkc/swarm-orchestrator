import { strict as assert } from 'assert';
import { renderPrComment } from '../../../src/audit/report-comment';
import type { AuditResult } from '../../../src/audit/types';

const PASS_RESULT: AuditResult = {
  pass: true,
  findings: [],
  generatedAt: '2026-05-23T00:00:00.000Z',
  detectorVersions: { 'test-relaxation': '1.0.0' },
};

const BLOCK_RESULT: AuditResult = {
  pass: false,
  generatedAt: '2026-05-23T00:00:00.000Z',
  detectorVersions: { 'test-relaxation': '1.0.0', 'assertion-strip': '1.0.0' },
  agent: { vendor: 'claude-code', version: '4.7', confidence: 'high', source: 'bot-author' },
  findings: [
    {
      category: 'test-relaxation',
      severity: 'block',
      message: 'Strict matcher swapped for loose.',
      location: { file: 'foo.test.ts', line: 12 },
      evidence: '- expect(x).toBe(1)\n+ expect(x).toBeDefined()',
    },
    {
      category: 'no-op-fix',
      severity: 'warn',
      message: 'Symbol mismatch.',
      location: { file: 'bar.test.ts', line: 4 },
      evidence: '(no overlap)',
    },
  ],
};

describe('audit / report-comment', () => {
  it('renders a PASS header for a clean audit', () => {
    const md = renderPrComment(PASS_RESULT);
    assert.ok(md.startsWith('# Swarm Audit: PASS\n'));
  });

  it('renders a BLOCK header when there are blocking findings', () => {
    const md = renderPrComment(BLOCK_RESULT);
    assert.ok(md.startsWith('# Swarm Audit: BLOCK\n'));
  });

  it('renders the agent attribution line', () => {
    const md = renderPrComment(BLOCK_RESULT);
    assert.ok(md.includes('Detected agent:'));
    assert.ok(md.includes('`claude-code`'));
    assert.ok(md.includes('v4.7'));
  });

  it('renders findings grouped by severity in the canonical order', () => {
    const md = renderPrComment(BLOCK_RESULT);
    const blockIdx = md.indexOf('Blocking');
    const warnIdx = md.indexOf('Warning');
    assert.notEqual(blockIdx, -1);
    assert.notEqual(warnIdx, -1);
    assert.ok(blockIdx < warnIdx);
  });

  it('includes ledger and AIBOM links when provided', () => {
    const md = renderPrComment(PASS_RESULT, {
      ledgerUrl: 'https://example.com/ledger.jsonl',
      aibomUrl: 'https://example.com/aibom.json',
      leaderboardUrl: 'https://moonrunnerkc.github.io/swarm-orchestrator/',
    });
    assert.ok(md.includes('https://example.com/ledger.jsonl'));
    assert.ok(md.includes('https://example.com/aibom.json'));
    assert.ok(md.includes('https://moonrunnerkc.github.io/swarm-orchestrator/'));
  });

  it('produces deterministic output for a fixed input', () => {
    const a = renderPrComment(BLOCK_RESULT);
    const b = renderPrComment(BLOCK_RESULT);
    assert.equal(a, b);
  });

  // PR-intent layer: top-of-comment note appears only when at least
  // one finding was upgraded by the layer.

  it('omits the intent-upgrade note when no finding was upgraded', () => {
    const md = renderPrComment(BLOCK_RESULT);
    assert.equal(md.includes('Severity raised by PR-intent layer'), false);
  });

  it('renders the intent-upgrade note when a finding has intentUpgraded:true', () => {
    const result: AuditResult = {
      ...BLOCK_RESULT,
      findings: [
        {
          ...BLOCK_RESULT.findings[0]!,
          intentUpgraded: true,
          message: 'Strict matcher swapped for loose. Severity raised because the PR claims a fix ("fix: x").',
        },
        BLOCK_RESULT.findings[1]!,
      ],
    };
    const md = renderPrComment(result);
    assert.ok(md.includes('Severity raised by PR-intent layer'));
    assert.ok(md.includes('`test-relaxation`'));
    assert.ok(md.includes('intentSeverityPolicy: off'));
  });

  it('intent-upgrade note lists every upgraded category exactly once', () => {
    const result: AuditResult = {
      ...BLOCK_RESULT,
      findings: [
        { ...BLOCK_RESULT.findings[0]!, intentUpgraded: true },
        { ...BLOCK_RESULT.findings[0]!, intentUpgraded: true }, // duplicate cat
        { ...BLOCK_RESULT.findings[1]!, intentUpgraded: true },
      ],
    };
    const md = renderPrComment(result);
    const noteLine = md.split('\n').find((l) => l.includes('Severity raised by PR-intent layer'));
    assert.ok(noteLine);
    assert.ok(/3 finding\(s\)/.test(noteLine!));
    assert.ok(/`test-relaxation`/.test(noteLine!));
    assert.ok(/`no-op-fix`/.test(noteLine!));
  });
});
