// Pins the two benchmarks:full contracts added in the 12.1.1 patch:
// per-category evasion robustness (a ragged CSV is judged at each
// category's own max tested depth, and a gap in depth rows is an error
// naming the category) and the canonical judge-environment manifest
// (conflicting ambient env aborts without the explicit override flag).

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyCanonicalJudgeEnv,
  loadEvasionRobust,
  loadJudgeEnvManifest,
} from '../../../scripts/benchmarks/full';

function writeCsv(root: string, rows: string[]): void {
  const dir = path.join(root, 'benchmarks', 'oracle-corpus');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'evasion-data.csv'),
    ['category,depth,detected,total,detection_rate', ...rows].join('\n') + '\n',
  );
}

function writeManifest(root: string, body: string): void {
  fs.mkdirSync(path.join(root, 'benchmarks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'benchmarks', 'judge-env.json'), body);
}

describe('benchmarks / full pipeline contracts', () => {
  describe('loadEvasionRobust', () => {
    it('judges each category at its own max tested depth', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-full-'));
      writeCsv(root, [
        'shallow,0,8,8,1',
        'shallow,1,8,8,1',
        'deep,0,5,5,1',
        'deep,1,5,5,1',
        'deep,2,5,5,1',
        'deep,3,4,5,0.8',
      ]);
      const out = loadEvasionRobust(root);
      assert.deepEqual(out.get('shallow'), { robust: true, testedDepth: 1 });
      assert.deepEqual(out.get('deep'), { robust: false, testedDepth: 3 });
    });

    it('errors, naming the category, on a gap in depth rows', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-full-'));
      writeCsv(root, ['gappy,0,8,8,1', 'gappy,2,8,8,1']);
      assert.throws(() => loadEvasionRobust(root), /category "gappy" is missing its depth-1 row/);
    });

    it('errors on a malformed row instead of defaulting', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-full-'));
      writeCsv(root, ['bad,zero,8,8,notarate']);
      assert.throws(() => loadEvasionRobust(root), /non-numeric depth or rate/);
    });
  });

  describe('canonical judge env manifest', () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      saved.provider = process.env.SWARM_JUDGE_PROVIDER;
      saved.model = process.env.SWARM_JUDGE_MODEL;
      delete process.env.SWARM_JUDGE_PROVIDER;
      delete process.env.SWARM_JUDGE_MODEL;
    });
    afterEach(() => {
      if (saved.provider === undefined) delete process.env.SWARM_JUDGE_PROVIDER;
      else process.env.SWARM_JUDGE_PROVIDER = saved.provider;
      if (saved.model === undefined) delete process.env.SWARM_JUDGE_MODEL;
      else process.env.SWARM_JUDGE_MODEL = saved.model;
    });

    it('errors when the manifest is missing', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-full-'));
      assert.throws(() => loadJudgeEnvManifest(root), /judge-env\.json is missing/);
    });

    it('errors on a missing field', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-full-'));
      writeManifest(root, '{"provider":"ollama","model":""}');
      assert.throws(() => loadJudgeEnvManifest(root), /field "model" is missing or empty/);
    });

    it('exports the manifest env when nothing conflicts', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-full-'));
      writeManifest(
        root,
        '{"provider":"ollama","model":"qwen3.6:35b-a3b","cacheRoot":"benchmarks/judge-cache"}',
      );
      const conflicts = applyCanonicalJudgeEnv(root, false);
      assert.deepEqual(conflicts, []);
      assert.equal(process.env.SWARM_JUDGE_PROVIDER, 'ollama');
      assert.equal(process.env.SWARM_JUDGE_MODEL, 'qwen3.6:35b-a3b');
    });

    it('aborts on a conflicting ambient env without the override flag', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-full-'));
      writeManifest(
        root,
        '{"provider":"ollama","model":"qwen3.6:35b-a3b","cacheRoot":"benchmarks/judge-cache"}',
      );
      process.env.SWARM_JUDGE_MODEL = 'some-other-model';
      assert.throws(
        () => applyCanonicalJudgeEnv(root, false),
        /SWARM_JUDGE_MODEL=some-other-model \(manifest: qwen3\.6:35b-a3b\).*--override-judge-env/s,
      );
    });

    it('reports but allows the conflict with the override flag', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-full-'));
      writeManifest(
        root,
        '{"provider":"ollama","model":"qwen3.6:35b-a3b","cacheRoot":"benchmarks/judge-cache"}',
      );
      process.env.SWARM_JUDGE_PROVIDER = 'local';
      const conflicts = applyCanonicalJudgeEnv(root, true);
      assert.equal(conflicts.length, 1);
      assert.match(conflicts[0]!, /SWARM_JUDGE_PROVIDER=local/);
      assert.equal(process.env.SWARM_JUDGE_PROVIDER, 'local');
    });
  });
});
