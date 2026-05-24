import { strict as assert } from 'assert';
import {
  BROKEN_TO_DETECTOR,
  ALL_DETECTOR_CATEGORIES,
  expectedDetectorsFor,
} from '../../../scripts/corpus/score-real';
import type { PrCorpusEntry } from '../../../benchmarks/real-corpus/schema';

function entryWith(overrides: Partial<PrCorpusEntry>): PrCorpusEntry {
  return {
    id: 'x',
    agent: { vendor: 'aider', confidence: 'high', source: 's' },
    pr: {
      number: 1,
      headSha: 'a',
      baseSha: 'b',
      headRef: 'r',
      title: 't',
      body: '',
      author: 'u',
      repository: 'o/r',
    },
    diffRef: { repository: 'o/r', headSha: 'a', baseSha: 'b' },
    vendoredDiffPath: 'aider/x.diff',
    vendoredAt: '2026-05-23T10:00:00.000Z',
    collectedAt: '2026-05-23T10:00:00.000Z',
    groundTruth: {
      verdict: 'broken',
      rationale: 'One. Two. Three.',
      labeledBy: 'brad',
      labeledAt: '2026-05-23T11:00:00.000Z',
      brokenCategories: ['cheat-test-modification'],
    },
    ...overrides,
  };
}

describe('score-real category mapping', () => {
  it('covers every BrokenCategory in the schema', () => {
    const schemaCategories = [
      'goal-not-fixed', 'regression', 'cheat-hardcoded-answer',
      'cheat-exception-swallowing', 'cheat-test-modification',
      'cheat-mock-mutation', 'edge-case-failure', 'under-tested',
      'type-flow-defect', 'concurrency-defect', 'resource-leak',
    ] as const;
    for (const cat of schemaCategories) {
      assert.ok(cat in BROKEN_TO_DETECTOR, `${cat} not in BROKEN_TO_DETECTOR`);
    }
  });

  it('maps cheat-test-modification to both test-relaxation and assertion-strip', () => {
    const mapped = BROKEN_TO_DETECTOR['cheat-test-modification'];
    assert.ok(mapped.includes('test-relaxation'));
    assert.ok(mapped.includes('assertion-strip'));
  });

  it('maps every detector category referenced to a real detector', () => {
    const valid = new Set(ALL_DETECTOR_CATEGORIES);
    for (const [, detectors] of Object.entries(BROKEN_TO_DETECTOR)) {
      for (const d of detectors) {
        assert.ok(valid.has(d), `unknown detector category ${d}`);
      }
    }
  });

  it('expectedDetectorsFor unions multiple broken categories', () => {
    const entry = entryWith({
      groundTruth: {
        verdict: 'broken',
        rationale: 'One. Two. Three.',
        labeledBy: 'brad',
        labeledAt: '2026-05-23T11:00:00.000Z',
        brokenCategories: ['cheat-test-modification', 'cheat-exception-swallowing'],
      },
    });
    const expected = expectedDetectorsFor(entry);
    assert.ok(expected.has('test-relaxation'));
    assert.ok(expected.has('assertion-strip'));
    assert.ok(expected.has('error-swallow'));
    // Post-Phase-1.75 mapping change: cheat-exception-swallowing maps only to
    // error-swallow, not also to exception-rethrow-lost-context. The two
    // detectors target structurally different patterns; mapping both would
    // manufacture FNs for whichever didn't fire on each labeled entry.
    assert.ok(!expected.has('exception-rethrow-lost-context'));
  });

  it('returns an empty set when brokenCategories has only unmapped values', () => {
    const entry = entryWith({
      groundTruth: {
        verdict: 'broken',
        rationale: 'One. Two. Three.',
        labeledBy: 'brad',
        labeledAt: '2026-05-23T11:00:00.000Z',
        brokenCategories: ['concurrency-defect', 'resource-leak'],
      },
    });
    assert.equal(expectedDetectorsFor(entry).size, 0);
  });
});
