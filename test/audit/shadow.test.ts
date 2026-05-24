import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeShadowEntry, listShadowEntries } from '../../src/audit/shadow';
import type { AuditResult } from '../../src/audit/types';

const RESULT: AuditResult = {
  pass: true,
  findings: [],
  generatedAt: '2026-05-23T00:00:00.000Z',
  detectorVersions: { 'error-swallow': '1.1.0' },
  detectorSet: 'default',
};

describe('audit / shadow (v10.2-advisory)', () => {
  it('writes a JSON entry under <shadowDir>/<repo>/<runId>.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-shadow-'));
    const file = writeShadowEntry(dir, 'aider-ai/aider', 'audit-abc123', {
      mode: 'advise',
      detectorSet: 'default',
      result: RESULT,
      wallTimeMs: 50,
    });
    assert.ok(fs.existsSync(file), `expected file at ${file}`);
    const text = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(text);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.runId, 'audit-abc123');
    assert.equal(parsed.repo, 'aider-ai/aider');
    assert.equal(parsed.mode, 'advise');
    assert.equal(parsed.detectorSet, 'default');
  });

  it('sanitizes path separators in the repo label for the directory name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-shadow-'));
    writeShadowEntry(dir, 'aider-ai/aider', 'r1', {
      mode: 'advise',
      detectorSet: 'default',
      result: RESULT,
      wallTimeMs: 0,
    });
    // Path separator turned into a dash; sub-dir exists under the dash form.
    const repoDirs = fs.readdirSync(dir);
    assert.deepEqual(repoDirs, ['aider-ai-aider']);
  });

  it('listShadowEntries replays prior runs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-shadow-'));
    writeShadowEntry(dir, 'r1', 'run-1', {
      mode: 'advise',
      detectorSet: 'default',
      result: RESULT,
      wallTimeMs: 0,
    });
    writeShadowEntry(dir, 'r2', 'run-2', {
      mode: 'gate',
      detectorSet: 'experimental',
      result: { ...RESULT, detectorSet: 'experimental' },
      wallTimeMs: 0,
    });
    const all = listShadowEntries(dir);
    assert.equal(all.length, 2);
    const r1 = listShadowEntries(dir, 'r1');
    assert.equal(r1.length, 1);
    assert.equal(r1[0]!.runId, 'run-1');
  });
});
