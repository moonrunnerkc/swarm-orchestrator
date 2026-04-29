import { strict as assert } from 'assert';
import {
  buildBenchmarkReport,
  formatRate,
  renderBenchmarkMarkdown,
} from '../../../benchmarks/falsification-corpus/benchmark-report';
import { computeBenchmarkMetrics, type BenchmarkRecord } from '../../../benchmarks/falsification-corpus/benchmark-metrics';
import type { BatteryResult } from '../../../benchmarks/falsification-corpus/harness';
import type { CorpusEntry } from '../../../benchmarks/falsification-corpus/schema';

describe('falsification benchmark report', () => {
  it('marks reports with n below ten as draft and renders key sections', () => {
    const records = [record('entry-1')];
    const report = buildBenchmarkReport({
      runId: 'run-1',
      generatedAt: '2026-04-29T00:00:00.000Z',
      corpusName: 'verification-runs',
      records,
      skippedUnlabeled: ['entry-2'],
      invalidLabels: [],
      metrics: computeBenchmarkMetrics(records),
      reproducibility: {
        corpusDir: '/corpus',
        labelsDir: '/labels',
        labelCommitHash: 'abc123',
        batteryLibraryCommitHash: 'def456',
        labelsDirty: false,
        batteryLibraryDirty: false,
      },
    });

    const markdown = renderBenchmarkMarkdown(report);

    assert.equal(report.draft, true);
    assert.match(markdown, /DRAFT - verification-runs falsification benchmark/);
    assert.match(markdown, /Per-Layer Metrics/);
    assert.match(markdown, /Composite Calibration/);
    assert.match(markdown, /Label commit hash: abc123/);
  });

  it('formats empty and populated rates with counts', () => {
    assert.equal(formatRate({ numerator: 0, denominator: 0, rate: null }), 'n/a (0/0)');
    assert.equal(formatRate({ numerator: 1, denominator: 4, rate: 0.25 }), '25.0% (1/4)');
  });
});

function record(id: string): BenchmarkRecord {
  return {
    entry: {
      id,
      source: 'verification-run',
      goalText: 'Fix the bug',
      repoPath: '/tmp/repo',
      baseCommit: '0'.repeat(40),
      patchCommit: '1'.repeat(40),
      agentIdentity: { cli: 'codex' },
      transcriptPath: '/tmp/share.md',
      groundTruth: {
        verdict: 'clean',
        rationale: 'First sentence. Second sentence. Third sentence.',
        labeledBy: 'reviewer',
        labeledAt: '2026-04-29T00:00:00.000Z',
      },
      metadata: {
        capturedAt: '2026-04-29T00:00:00.000Z',
        runDir: '/tmp/run',
        stepNumber: 1,
      },
    } satisfies CorpusEntry,
    result: battery(id),
  };
}

function battery(entryId: string): BatteryResult {
  const layer = { status: 'pass' as const, score: 1, evidence: {} };
  return {
    entryId,
    layers: {
      intent: layer,
      regression: layer,
      cheat: layer,
      property: layer,
      attestation: layer,
    },
    compositeScore: 1,
    broke: false,
    flagged: false,
    timing: {
      totalMs: 5,
      perLayerMs: { intent: 1, regression: 1, cheat: 1, property: 1, attestation: 1 },
    },
    errors: [],
  };
}
