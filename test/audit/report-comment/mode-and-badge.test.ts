import { strict as assert } from 'assert';
import { renderPrComment } from '../../../src/audit/report-comment';
import type { AuditResult } from '../../../src/audit/types';

const ADVISE_BLOCK_RESULT: AuditResult = {
  pass: false,
  generatedAt: '2026-05-23T00:00:00.000Z',
  detectorVersions: { 'error-swallow': '1.1.0' },
  detectorSet: 'default',
  findings: [
    {
      category: 'error-swallow',
      severity: 'block',
      message: 'A bare empty catch block was added in src/x.ts.',
      location: { file: 'src/x.ts', line: 4 },
      evidence: '+ } catch {}',
    },
  ],
};

describe('audit / report-comment / mode + precision badge (v10.2-advisory)', () => {
  it('renders the ADVISORY headline in advise mode', () => {
    const md = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'advise' });
    assert.ok(md.startsWith('# Swarm Audit: ADVISORY'));
  });

  it('renders the gating BLOCK headline in gate mode', () => {
    const md = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'gate' });
    assert.ok(md.startsWith('# Swarm Audit: BLOCK'));
  });

  it('advise-mode subtitle does NOT call findings "must be addressed"', () => {
    const md = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'advise' });
    assert.equal(md.includes('must be addressed before this PR can be merged'), false);
  });

  it('advise-mode banner names the --mode=advise flag explicitly', () => {
    const md = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'advise' });
    assert.ok(md.includes('--mode=advise'));
    assert.ok(md.includes('Merging is not blocked'));
  });

  it('gate-mode banner names the --mode=gate flag explicitly', () => {
    const md = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'gate' });
    assert.ok(md.includes('--mode=gate'));
  });

  it('per-finding precision badge renders for measured detectors', () => {
    const md = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'gate' });
    assert.ok(/Detector precision badge:.*precision\s+\d/.test(md));
    // error-swallow precision is 0.19 on the real corpus.
    assert.ok(md.includes('0.19'));
    assert.ok(md.includes('real-corpus'));
  });

  it('summary section names the detector set', () => {
    const md = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'advise' });
    // Renderer emits markdown bold around the label; just check the
    // label and the set name appear on the same logical line.
    assert.ok(/Detector set:.*`default`/.test(md));
  });

  it('blocking-severity header is reframed under advise mode', () => {
    const md = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'advise' });
    assert.ok(md.includes('advisory only, not gating'));
  });

  it('rendered output is still deterministic at a fixed generatedAt', () => {
    const a = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'advise' });
    const b = renderPrComment(ADVISE_BLOCK_RESULT, { mode: 'advise' });
    assert.equal(a, b);
  });
});
