import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runSyntheticCalibration } from '../../../benchmarks/falsification-corpus/synthetic/synthetic-calibration';
import { loadSyntheticCorpus } from '../../../benchmarks/falsification-corpus/synthetic/synthetic-corpus';

describe('falsification synthetic calibration', function () {
  this.timeout(20_000);

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falsification-synthetic-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('materializes paired broken and clean entries with labels', () => {
    const corpus = loadSyntheticCorpus(path.join(tmpDir, 'synthetic'));

    assert.equal(corpus.entries.length, 36);
    assert.equal(corpus.entries.filter(entry => entry.groundTruth.verdict === 'broken').length, 18);
    assert.equal(corpus.entries.filter(entry => entry.groundTruth.verdict === 'clean').length, 18);
    assert.ok(corpus.entries.every(entry => fs.existsSync(entry.repoPath)));
    assert.ok(corpus.entries.every(entry => fs.existsSync(entry.transcriptPath)));
  });

  it('runs synthetic calibration with no target-layer misses', async () => {
    const outputDir = path.join(tmpDir, 'out');
    const summary = await runSyntheticCalibration({
      syntheticRoot: path.join(tmpDir, 'synthetic'),
      outputDir,
      commitHash: 'test-commit',
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
});
