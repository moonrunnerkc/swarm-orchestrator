import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseBrokenCategories,
  validateGroundTruthLabel,
} from '../../../benchmarks/falsification-corpus/label-rules';
import {
  buildLabelStatus,
  readLabel,
  summarizeLabelStatus,
  writeLabel,
} from '../../../benchmarks/falsification-corpus/label-store';
import type { GroundTruthLabel, UnlabeledCorpusEntry } from '../../../benchmarks/falsification-corpus/schema';

describe('falsification corpus labeling workflow', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falsification-labels-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enforces rationale, broken category, and ambiguous review rules', () => {
    assert.ok(validateGroundTruthLabel({
      verdict: 'clean',
      rationale: 'Too short.',
      labeledBy: 'reviewer',
      labeledAt: '2026-04-29T00:00:00.000Z',
    }).some(issue => issue.includes('three sentences')));

    assert.ok(validateGroundTruthLabel({
      verdict: 'broken',
      rationale: 'First sentence. Second sentence. Third sentence.',
      labeledBy: 'reviewer',
      labeledAt: '2026-04-29T00:00:00.000Z',
    }).some(issue => issue.includes('at least one broken category')));

    assert.ok(validateGroundTruthLabel({
      verdict: 'ambiguous',
      rationale: 'First sentence. Second sentence. Third sentence.',
      labeledBy: 'reviewer',
      labeledAt: '2026-04-29T00:00:00.000Z',
    }).some(issue => issue.includes('reviewedBy')));
  });

  it('parses and validates broken categories from CLI input', () => {
    const categories = parseBrokenCategories('regression, cheat-test-modification');

    assert.deepEqual(categories, ['regression', 'cheat-test-modification']);
    assert.deepEqual(validateGroundTruthLabel({
      verdict: 'broken',
      rationale: 'First sentence. Second sentence. Third sentence.',
      brokenCategories: categories,
      labeledBy: 'reviewer',
      labeledAt: '2026-04-29T00:00:00.000Z',
    }), []);
  });

  it('writes labels and refuses overwrite without replace', async () => {
    const labelsDir = path.join(tmpDir, 'labels');
    const label = cleanLabel();
    const labelPath = await writeLabel(labelsDir, 'entry-1', label);

    assert.equal(path.isAbsolute(labelPath), true);
    assert.deepEqual((await readLabel(labelsDir, 'entry-1'))?.label, label);
    await assert.rejects(
      () => writeLabel(labelsDir, 'entry-1', label),
      /--replace/,
    );
    await writeLabel(labelsDir, 'entry-1', label, { replace: true });
  });

  it('builds label status rows and verdict summaries', async () => {
    const labelsDir = path.join(tmpDir, 'labels');
    const entries = [entry('entry-1'), entry('entry-2')];
    await writeLabel(labelsDir, 'entry-1', cleanLabel());

    const rows = await buildLabelStatus(entries, labelsDir);
    const summary = summarizeLabelStatus(rows);

    assert.equal(rows[0].status, 'labeled');
    assert.equal(rows[1].status, 'unlabeled');
    assert.equal(summary.labeled, 1);
    assert.equal(summary.unlabeled, 1);
    assert.equal(summary['verdict:clean'], 1);
  });
});

function cleanLabel(): GroundTruthLabel {
  return {
    verdict: 'clean',
    rationale: 'The patch changes the requested file. It satisfies the goal without extra scope. The diff evidence supports the clean verdict.',
    labeledBy: 'reviewer',
    labeledAt: '2026-04-29T00:00:00.000Z',
  };
}

function entry(id: string): UnlabeledCorpusEntry {
  return {
    id,
    source: 'verification-run',
    goalText: 'Fix the bug',
    repoPath: tmpPath(),
    baseCommit: '0'.repeat(40),
    patchCommit: '1'.repeat(40),
    agentIdentity: { cli: 'codex', model: 'gpt-5.4' },
    transcriptPath: tmpPath(),
    metadata: {
      capturedAt: '2026-04-29T00:00:00.000Z',
      runDir: tmpPath(),
      stepNumber: 1,
    },
  };
}

function tmpPath(): string {
  return path.join(os.tmpdir(), 'falsification-label-path');
}
