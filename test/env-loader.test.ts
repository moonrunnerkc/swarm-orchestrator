import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv, parseDotenvFile } from '../src/env-loader';

/**
 * Unit tests for `parseDotenvFile` and `loadDotenv`. The functions mutate
 * `process.env`, so each test snapshots and restores the keys it touches.
 */

const TEST_KEYS = [
  'SWARM_ENV_TEST_K1',
  'SWARM_ENV_TEST_K2',
  'SWARM_ENV_TEST_K3',
  'SWARM_ENV_TEST_QUOTED',
  'SWARM_ENV_TEST_EXPORT',
  'SWARM_ENV_TEST_NO_OVERRIDE',
];

function snapshot(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of TEST_KEYS) snap[k] = process.env[k];
  return snap;
}

function restore(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('env-loader parseDotenvFile', () => {
  let tmpDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'env-loader-test-')));
    originalEnv = snapshot();
    for (const k of TEST_KEYS) delete process.env[k];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    restore(originalEnv);
  });

  it('is a no-op when the file does not exist', () => {
    parseDotenvFile(path.join(tmpDir, 'missing.env'));
    assert.equal(process.env.SWARM_ENV_TEST_K1, undefined);
  });

  it('parses bare KEY=value lines and sets them on process.env', () => {
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, 'SWARM_ENV_TEST_K1=plain\n');
    parseDotenvFile(file);
    assert.equal(process.env.SWARM_ENV_TEST_K1, 'plain');
  });

  it('strips matching surrounding double or single quotes', () => {
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, [
      'SWARM_ENV_TEST_K1="double quoted"',
      "SWARM_ENV_TEST_K2='single quoted'",
      'SWARM_ENV_TEST_QUOTED=" with spaces "',
    ].join('\n'));
    parseDotenvFile(file);
    assert.equal(process.env.SWARM_ENV_TEST_K1, 'double quoted');
    assert.equal(process.env.SWARM_ENV_TEST_K2, 'single quoted');
    assert.equal(process.env.SWARM_ENV_TEST_QUOTED, ' with spaces ');
  });

  it('honors the `export KEY=value` form', () => {
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, 'export SWARM_ENV_TEST_EXPORT=ok\n');
    parseDotenvFile(file);
    assert.equal(process.env.SWARM_ENV_TEST_EXPORT, 'ok');
  });

  it('skips blank lines and comments', () => {
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, [
      '',
      '# this is a comment',
      '   ',
      'SWARM_ENV_TEST_K1=after-comment',
    ].join('\n'));
    parseDotenvFile(file);
    assert.equal(process.env.SWARM_ENV_TEST_K1, 'after-comment');
  });

  it('does not overwrite a key that is already present in process.env', () => {
    process.env.SWARM_ENV_TEST_NO_OVERRIDE = 'shell-value';
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, 'SWARM_ENV_TEST_NO_OVERRIDE=file-value\n');
    parseDotenvFile(file);
    assert.equal(
      process.env.SWARM_ENV_TEST_NO_OVERRIDE,
      'shell-value',
      'shell-exported value must beat the .env file',
    );
  });

  it('ignores lines without an = sign', () => {
    const file = path.join(tmpDir, '.env');
    fs.writeFileSync(file, 'just-a-bare-token\nSWARM_ENV_TEST_K1=ok\n');
    parseDotenvFile(file);
    assert.equal(process.env.SWARM_ENV_TEST_K1, 'ok');
  });
});

describe('env-loader loadDotenv', () => {
  let tmpDir: string;
  let originalCwd: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'env-loader-load-')));
    originalCwd = process.cwd();
    originalEnv = snapshot();
    for (const k of TEST_KEYS) delete process.env[k];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    restore(originalEnv);
  });

  it('reads the cwd .env first', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SWARM_ENV_TEST_K1=cwd\n');
    process.chdir(tmpDir);
    // Pass a non-existent orchestrator root so the cwd .env is the only candidate.
    loadDotenv(path.join(tmpDir, 'no-such-root'));
    assert.equal(process.env.SWARM_ENV_TEST_K1, 'cwd');
  });

  it('falls back to the orchestrator install dir when cwd has no .env', () => {
    const orchestratorRoot = path.join(tmpDir, 'orchestrator');
    fs.mkdirSync(orchestratorRoot);
    fs.writeFileSync(path.join(orchestratorRoot, '.env'), 'SWARM_ENV_TEST_K2=orchestrator\n');
    const cwd = path.join(tmpDir, 'cwd');
    fs.mkdirSync(cwd);
    process.chdir(cwd);
    loadDotenv(orchestratorRoot);
    assert.equal(process.env.SWARM_ENV_TEST_K2, 'orchestrator');
  });

  it('treats cwd-and-orchestrator-the-same as a single source (no double load)', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SWARM_ENV_TEST_K1=once\n');
    process.chdir(tmpDir);
    loadDotenv(tmpDir);
    assert.equal(process.env.SWARM_ENV_TEST_K1, 'once');
  });
});
