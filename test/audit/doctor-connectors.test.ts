import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_RESOLVED = path.resolve(__dirname, '..', '..', '..', 'dist', 'src', 'cli.js');

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): { stdout: string; stderr: string; exitCode: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-doctor-conn-'));
  const res = spawnSync('node', [CLI_RESOLVED, ...args, '--cwd', dir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env, PATH: process.env.PATH ?? '' },
  });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', exitCode: res.status ?? 1 };
}

describe('doctor / --connectors', function () {
  this.timeout(10_000);

  it('includes the connector probe surface when --connectors is passed', () => {
    const { stdout, stderr } = runCli(['doctor', '--connectors'], { GITHUB_TOKEN: 'gh_dummy_token_with_length_over_twenty' });
    const combined = stdout + stderr;
    assert.ok(combined.includes('GITHUB_TOKEN'), combined);
    assert.ok(combined.includes('cheat-detector engine'), combined);
    assert.ok(combined.includes('AI-BOM output directory'), combined);
  });

  it('reports GITHUB_TOKEN missing when env var is empty', () => {
    const { stdout, stderr } = runCli(['doctor', '--connectors'], { GITHUB_TOKEN: '', GH_TOKEN: '' });
    const combined = stdout + stderr;
    assert.ok(combined.includes('GITHUB_TOKEN'), combined);
    assert.ok(combined.includes('not set'), combined);
  });

  it('does not emit connector probes without --connectors', () => {
    const { stdout, stderr } = runCli(['doctor']);
    const combined = stdout + stderr;
    assert.equal(combined.includes('cheat-detector engine'), false);
    assert.equal(combined.includes('AI-BOM output directory'), false);
  });
});
