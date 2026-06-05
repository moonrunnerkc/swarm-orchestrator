import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  localizedExperimentPath,
  readLocalizedExperiment,
  writeLocalizedExperiment,
  type LocalizedExperiment,
} from '../../../scripts/oracle/localized-experiment';
import { buildReport as buildTailReport } from '../../../scripts/oracle/tail-defect';
import { buildReport as buildPerHunkReport } from '../../../scripts/oracle/per-hunk';

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-localized-'));
  fs.mkdirSync(path.join(root, 'benchmarks', 'oracle-corpus'), { recursive: true });
  return root;
}

const SAMPLE: LocalizedExperiment = {
  measuredAt: '2026-06',
  model: 'glm47-flash-abl',
  note: 'test fixture',
  tailDefect: { count: 10, localizedCaught: 5 },
  perHunk: { count: 10, localizedDefectFlagged: 0, localizedPointedCorrectly: 0, localizedBenignFalse: 10 },
};

describe('oracle / localized-experiment', () => {
  describe('read/write', () => {
    it('round-trips the frozen experiment through disk', () => {
      const root = tmpRoot();
      writeLocalizedExperiment(root, SAMPLE);
      assert.ok(fs.existsSync(localizedExperimentPath(root)));
      assert.deepEqual(readLocalizedExperiment(root), SAMPLE);
    });

    it('throws a remediation-bearing error when the sidecar is missing', () => {
      const root = tmpRoot();
      assert.throws(() => readLocalizedExperiment(root), /committed evidence/);
    });
  });

  describe('tail-defect buildReport', () => {
    it('emits the v2 section with the frozen localized recall', () => {
      const md = buildTailReport({ count: 10, headHits: 0, chunkHits: 1, localizedCaught: 5 });
      assert.ok(md.includes('## v2: localized confirm prompt'));
      assert.ok(md.includes('| localized (experiment) | 5/10 | 0.500 |'));
      assert.ok(md.includes('lifts tail-defect recall to 0.5 (+0.4 absolute)'));
      assert.ok(!md.includes('—'), 'no em dash');
    });
  });

  describe('per-hunk buildReport', () => {
    it('emits the v2 section with the frozen localized row', () => {
      const md = buildPerHunkReport({
        count: 10,
        wholeFlagged: 2,
        conservative: { defectHunkFlagged: 0, benignHunkFalse: 10, pointedCorrectly: 0, decisive: 40 },
        localizedDefectFlagged: 0,
        localizedPointedCorrectly: 0,
        localizedBenignFalse: 10,
      });
      assert.ok(md.includes('## v2: localized confirm prompt'));
      assert.ok(md.includes('| localized (experiment) | 0/10 | 0/10 | 10/10 |'));
      assert.ok(!md.includes('—'), 'no em dash');
    });
  });
});
