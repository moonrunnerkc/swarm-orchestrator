import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeCompositeScore,
  loadCompositeScoreConfig,
} from '../../src/verification';
import { GateResult } from '../../src/quality-gates/types';

describe('composite score', () => {
  it('returns 1.0 when all layers pass', () => {
    const result = computeCompositeScore({
      cheatDetectorScore: 1,
      propertyGateScore: 1,
      attestationScore: 1,
    });

    assert.strictEqual(result.score, 1);
    assert.strictEqual(result.humanReviewRequired, false);
  });

  it('computes the documented 0.72 example above threshold', () => {
    const result = computeCompositeScore({
      cheatDetectorScore: 0.3,
      propertyGateScore: 1,
      attestationScore: 1,
    });

    assert.strictEqual(result.score, 0.72);
    assert.strictEqual(result.humanReviewRequired, false);
  });

  it('requires human review when an advisory layer fires above threshold', () => {
    const result = computeCompositeScore({
      cheatDetectorScore: 0.65,
      propertyGateScore: 1,
      attestationScore: 1,
      advisoryLayerStatuses: {
        cheat: 'advisory-warn',
        property: 'pass',
        attestation: 'pass',
      },
    });

    assert.strictEqual(result.score, 0.86);
    assert.strictEqual(result.humanReviewRequired, true);
    assert.strictEqual(result.advisoryLayerTriggered, true);
  });

  it('computes the documented 0.28 example and triggers review', () => {
    const result = computeCompositeScore({
      cheatDetectorScore: 0,
      propertyGateScore: 0.2,
      attestationScore: 1,
    });

    assert.strictEqual(result.score, 0.28);
    assert.strictEqual(result.humanReviewRequired, true);
  });

  it('applies configurable weights from gates.yaml', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'composite-config-'));
    try {
      fs.mkdirSync(path.join(root, '.swarm'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarm', 'gates.yaml'), [
        'verification:',
        '  composite:',
        '    threshold: 0.5',
        '    weights:',
        '      cheatDetector: 1',
        '      propertyGate: 0',
        '      attestation: 0',
        '',
      ].join('\n'), 'utf8');

      const config = loadCompositeScoreConfig(root);
      const result = computeCompositeScore({
        cheatDetectorScore: 0.42,
        propertyGateScore: 1,
        attestationScore: 1,
        config,
      });

      assert.strictEqual(result.score, 0.42);
      assert.strictEqual(result.threshold, 0.5);
      assert.strictEqual(result.humanReviewRequired, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('subtracts advisory quality gate penalties', () => {
    const gates: GateResult[] = [{
      id: 'readme-claims',
      title: 'README claims',
      status: 'fail',
      durationMs: 1,
      issues: [{ message: 'claim lacks evidence' }],
    }];

    const result = computeCompositeScore({
      cheatDetectorScore: 1,
      propertyGateScore: 1,
      attestationScore: 1,
      advisoryGateResults: gates,
    });

    assert.strictEqual(result.score, 0.98);
    assert.strictEqual(result.advisoryPenalty, 0.02);
  });
});
