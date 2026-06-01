import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleDoctor } from '../../src/cli/v8/doctor-handler';

function tempCwd(config: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-jp-'));
  fs.mkdirSync(path.join(dir, '.swarm'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.swarm', 'audit-config.yaml'), config);
  return dir;
}

// The doctor's overall exit code is environment-dependent (API key, .swarm
// subdirs), so these assert the deterministic fix behavior on the config
// file rather than the exit code.
describe('doctor / judgePrimary', () => {
  it('--fix drops an unknown judgePrimary category and keeps the valid one', async () => {
    const cwd = tempCwd('judgePrimary:\n  categories:\n    - goal-not-fixed\n    - made-up-category\n');
    await handleDoctor(['--cwd', cwd, '--fix']);
    const text = fs.readFileSync(path.join(cwd, '.swarm', 'audit-config.yaml'), 'utf8');
    assert.ok(!text.includes('made-up-category'), 'unknown category should be removed');
    assert.ok(text.includes('goal-not-fixed'), 'valid category should remain');
  });

  it('--fix drops an unknown category from an inline list', async () => {
    const cwd = tempCwd('judgePrimary:\n  categories: [goal-not-fixed, bogus]\n');
    await handleDoctor(['--cwd', cwd, '--fix']);
    const text = fs.readFileSync(path.join(cwd, '.swarm', 'audit-config.yaml'), 'utf8');
    assert.ok(!text.includes('bogus'), 'unknown inline category should be removed');
    assert.ok(text.includes('goal-not-fixed'));
  });

  it('leaves a config with only valid categories unchanged', async () => {
    const original = 'judgePrimary:\n  enabled: true\n  categories: [goal-not-fixed, cheat-mock-mutation]\n';
    const cwd = tempCwd(original);
    await handleDoctor(['--cwd', cwd, '--fix']);
    const text = fs.readFileSync(path.join(cwd, '.swarm', 'audit-config.yaml'), 'utf8');
    assert.ok(text.includes('goal-not-fixed') && text.includes('cheat-mock-mutation'));
  });
});
