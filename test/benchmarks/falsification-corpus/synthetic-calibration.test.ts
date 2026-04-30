import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BROKEN_CATEGORIES } from '../../../benchmarks/falsification-corpus/label-rules';
import { runSyntheticCalibration } from '../../../benchmarks/falsification-corpus/synthetic/synthetic-calibration';
import { loadSyntheticCorpus } from '../../../benchmarks/falsification-corpus/synthetic/synthetic-corpus';
import type { BrokenCategory } from '../../../benchmarks/falsification-corpus/schema';

describe('falsification synthetic calibration', function () {
  this.timeout(60_000);

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falsification-synthetic-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('materializes paired broken and clean entries with labels', () => {
    const corpus = loadSyntheticCorpus(path.join(tmpDir, 'synthetic'));

    assert.equal(corpus.entries.length, 42);
    assert.equal(corpus.entries.filter(entry => entry.groundTruth.verdict === 'broken').length, 21);
    assert.equal(corpus.entries.filter(entry => entry.groundTruth.verdict === 'clean').length, 21);
    assert.ok(corpus.entries.every(entry => fs.existsSync(entry.repoPath)));
    assert.ok(corpus.entries.every(entry => fs.existsSync(entry.transcriptPath)));
  });

  it('runs synthetic calibration with no target-layer misses for non-mutation categories', async () => {
    const outputDir = path.join(tmpDir, 'out');
    const summary = await runSyntheticCalibration({
      syntheticRoot: path.join(tmpDir, 'synthetic'),
      outputDir,
      commitHash: 'test-commit',
      categories: nonMutationOnlyCategories(),
    });
    const report = JSON.parse(fs.readFileSync(summary.reportJsonPath, 'utf8')) as {
      metrics: { n: number };
      syntheticCalibration: Array<{ targetMisses: number; targetFalsePositives: number }>;
    };

    assert.equal(summary.records, 36);
    assert.equal(summary.misses.length, 0);
    assert.equal(report.metrics.n, 36);
    assert.ok(report.syntheticCalibration.every(row => row.targetMisses === 0));
    assert.ok(report.syntheticCalibration.every(row => row.targetFalsePositives === 0));
    assert.equal(fs.existsSync(summary.reportMarkdownPath), true);
  });

  it('runs under-tested calibration with mutation enabled', async () => {
    const outputDir = path.join(tmpDir, 'under-tested-out');
    const summary = await runSyntheticCalibration({
      syntheticRoot: path.join(tmpDir, 'synthetic'),
      outputDir,
      commitHash: 'test-commit',
      categories: ['under-tested'],
      skipMutation: false,
    });
    const report = JSON.parse(fs.readFileSync(summary.reportJsonPath, 'utf8')) as {
      metrics: { n: number; catchRate: { numerator: number; denominator: number; rate: number | null } };
      syntheticCalibration: Array<{
        category: BrokenCategory;
        targetMisses: number;
        targetFalsePositives: number;
        brokenCount: number;
      }>;
    };
    const brokenResults = fs.readdirSync(path.join(outputDir, 'per-entry'))
      .filter(file => file.endsWith('-broken.json'))
      .map(file => JSON.parse(fs.readFileSync(path.join(outputDir, 'per-entry', file), 'utf8')) as MutationEntryResult);

    assert.equal(summary.records, 6);
    assert.equal(summary.misses.length, 0);
    assert.deepEqual(report.metrics.catchRate, { numerator: 3, denominator: 3, rate: 1 });
    assert.deepEqual(report.syntheticCalibration, [{
      category: 'under-tested',
      targetLayers: ['regression'],
      brokenCount: 3,
      targetMisses: 0,
      cleanCount: 3,
      targetFalsePositives: 0,
    }]);
    assert.equal(brokenResults.length, 3);
    assert.ok(brokenResults.every(result => result.layers.regression.status === 'fail'));
    assert.ok(brokenResults.every(result => result.layers.regression.evidence.mutation.totalMutants > 0));
  });
});

interface MutationEntryResult {
  layers: {
    regression: {
      status: string;
      evidence: {
        mutation: {
          totalMutants: number;
        };
      };
    };
  };
}

function nonMutationOnlyCategories(): BrokenCategory[] {
  return BROKEN_CATEGORIES.filter(category => category !== 'under-tested');
}
