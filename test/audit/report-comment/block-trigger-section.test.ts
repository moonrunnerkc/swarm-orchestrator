import { strict as assert } from 'assert';
import { renderBlockTriggerSection } from '../../../src/audit/report-comment/block-trigger-section';
import { renderPrComment } from '../../../src/audit/report-comment';
import type { BlockTrigger } from '../../../src/audit/gate/block-triggers';
import type { AuditResult } from '../../../src/audit/types';

const claimTrigger: BlockTrigger = {
  kind: 'claim-falsified',
  summary: 'The fix this PR claims for acme/widgets#42 does not deliver.',
  reproduce: 'node __swarm_repro__.js',
  evidence: {
    kind: 'claim-falsified',
    issueRef: 'acme/widgets#42',
    claim: 'fixes #42',
    reproCommand: 'node __swarm_repro__.js',
    preStatus: 'failed',
    postStatus: 'failed',
    preRuns: ['failed', 'failed'],
    postRuns: ['failed', 'failed'],
    postOutput: 'Error: charge not applied',
  },
};

function baseResult(): AuditResult {
  return {
    pass: true,
    findings: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    detectorVersions: {},
  };
}

describe('renderBlockTriggerSection', () => {
  it('renders nothing when there are no triggers', () => {
    assert.deepEqual(renderBlockTriggerSection([], 'gate'), []);
  });

  it('shows the reproduce command and the captured evidence in gate mode', () => {
    const md = renderBlockTriggerSection([claimTrigger], 'gate').join('\n');
    assert.match(md, /## Blocking evidence \(1\)/);
    assert.match(md, /node __swarm_repro__\.js/);
    assert.match(md, /charge not applied/);
    assert.match(md, /acme\/widgets#42/);
  });

  it('frames the same evidence as advisory in advise mode', () => {
    const md = renderBlockTriggerSection([claimTrigger], 'advise').join('\n');
    assert.match(md, /## Verifiable evidence \(1\)/);
    assert.match(md, /not blocking/i);
  });
});

describe('renderPrComment with block triggers', () => {
  it('embeds the reproduce command so a blocked author can re-run it', () => {
    const md = renderPrComment(baseResult(), { mode: 'gate', blockTriggers: [claimTrigger] });
    assert.match(md, /Reproduce:/);
    assert.match(md, /node __swarm_repro__\.js/);
  });

  it('renders unchanged when no triggers are passed', () => {
    const md = renderPrComment(baseResult(), { mode: 'gate' });
    assert.doesNotMatch(md, /Blocking evidence/);
  });
});
