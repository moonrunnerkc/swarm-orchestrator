import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  commandTimeoutMs,
  execEnv,
  execFileGuarded,
  isGuardedTimeout,
} from '../../../src/audit/execution-grounded/exec-env';

// execEnv builds the environment handed to untrusted code (npm postinstall, the
// PR's own test suite). The contract under test: the auditor's credentials never
// reach that child by default, and only an explicit operator opt-in lets one
// through.
describe('execution-grounded / exec-env env scrubbing', () => {
  const SAVED = process.env;

  beforeEach(() => {
    // Start from a clean slate each test so leftover host vars do not leak in.
    process.env = { PATH: SAVED.PATH ?? '/usr/bin', HOME: '/home/auditor' };
  });

  afterEach(() => {
    process.env = SAVED;
  });

  it('drops the three named API keys by default', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret';
    process.env.OPENAI_API_KEY = 'sk-openai-secret';
    process.env.GITHUB_TOKEN = 'ghp_secret';

    const env = execEnv();

    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
  });

  it('drops secret-shaped vars, including ones no regex would catch', () => {
    process.env.MY_DB_SECRET = 'shh';
    process.env.SLACK_TOKEN = 'xoxb-shh';
    process.env.DB_PASSWORD = 'hunter2';
    process.env.GH_PAT = 'ghp_unpatterned'; // no _TOKEN/_KEY/_SECRET in the name
    process.env.DATABASE_URL = 'postgres://user:pw@host/db';

    const env = execEnv();

    assert.equal(env.MY_DB_SECRET, undefined);
    assert.equal(env.SLACK_TOKEN, undefined);
    assert.equal(env.DB_PASSWORD, undefined);
    assert.equal(env.GH_PAT, undefined, 'a strict allowlist drops secrets a denylist regex would miss');
    assert.equal(env.DATABASE_URL, undefined);
  });

  it('keeps the vars a package manager and test runner actually need', () => {
    process.env.TMPDIR = '/tmp/auditor';
    process.env.LANG = 'en_US.UTF-8';

    const env = execEnv();

    assert.equal(env.HOME, '/home/auditor');
    assert.equal(env.TMPDIR, '/tmp/auditor');
    assert.equal(env.LANG, 'en_US.UTF-8');
    assert.ok(env.PATH !== undefined && env.PATH.length > 0, 'PATH is always set');
    // Headless forcing is applied unconditionally.
    assert.equal(env.CI, 'true');
    assert.equal(env.BROWSER, 'none');
  });

  it('lets a secret through only when named in SWARM_EG_ENV_PASSTHROUGH', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret';
    process.env.GITHUB_TOKEN = 'ghp_secret';
    process.env.SWARM_EG_ENV_PASSTHROUGH = 'GITHUB_TOKEN, HTTPS_PROXY';
    process.env.HTTPS_PROXY = 'http://proxy.internal:8080';

    const env = execEnv();

    assert.equal(env.GITHUB_TOKEN, 'ghp_secret', 'explicitly passed through');
    assert.equal(env.HTTPS_PROXY, 'http://proxy.internal:8080', 'explicitly passed through');
    assert.equal(env.ANTHROPIC_API_KEY, undefined, 'not passed through, still dropped');
  });

  it('pins the toolchain bin dir onto PATH and sets the npm cache override', () => {
    process.env.SWARM_EG_NODE_BIN = '/opt/node20/bin';

    const env = execEnv('/var/cache/eg');

    assert.ok(
      env.PATH !== undefined && env.PATH.startsWith(`/opt/node20/bin${path.delimiter}`),
      'pinned Node bin dir is prepended to PATH',
    );
    assert.equal(env.npm_config_cache, '/var/cache/eg');
  });
});

// The sandbox runs a PR's own (untrusted) test command; a suite that hangs or
// forks a dev server must not wedge the auditor. execFileGuarded caps the wall
// clock and kills the whole process group, not just the direct child.
describe('execution-grounded / exec-env guarded command runner', () => {
  it('resolves the timeout: explicit wins, else env, else the 5m default', () => {
    const SAVED = process.env.SWARM_EG_COMMAND_TIMEOUT_MS;
    try {
      delete process.env.SWARM_EG_COMMAND_TIMEOUT_MS;
      assert.equal(commandTimeoutMs(), 5 * 60 * 1000);
      assert.equal(commandTimeoutMs(1234), 1234);
      process.env.SWARM_EG_COMMAND_TIMEOUT_MS = '7777';
      assert.equal(commandTimeoutMs(), 7777);
      assert.equal(commandTimeoutMs(1234), 1234, 'an explicit budget still wins over the env');
    } finally {
      if (SAVED === undefined) delete process.env.SWARM_EG_COMMAND_TIMEOUT_MS;
      else process.env.SWARM_EG_COMMAND_TIMEOUT_MS = SAVED;
    }
  });

  it('times out a command that never exits and flags it as a timeout', () => {
    const start = Date.now();
    let thrown: unknown;
    try {
      execFileGuarded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 400,
      });
    } catch (err) {
      thrown = err;
    }
    const elapsed = Date.now() - start;
    assert.ok(thrown !== undefined, 'a command that never exits must throw');
    assert.ok(isGuardedTimeout(thrown), 'the throw carries the timedOut flag');
    assert.ok(elapsed < 5000, `killed promptly, not at the 1000ms interval cadence (took ${elapsed}ms)`);
  });

  const groupTest = process.platform === 'win32' ? it.skip : it;
  groupTest('kills the whole process group, not just the direct child', async () => {
    const marker = path.join(os.tmpdir(), `swarm-eg-group-${process.pid}-${Date.now()}.marker`);
    fs.rmSync(marker, { force: true });
    // The direct child forks a grandchild that would write the marker after 3s,
    // then hangs forever. If only the direct child were signalled on timeout,
    // the grandchild would survive and write the marker. A process-group kill
    // reaps both, so the marker never appears.
    const grandchild = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 3000)`;
    const script =
      `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });` +
      `setInterval(() => {}, 1000);`;
    try {
      execFileGuarded(process.execPath, ['-e', script], { cwd: process.cwd(), env: process.env, timeoutMs: 400 });
      assert.fail('expected the hung command to time out');
    } catch (err) {
      assert.ok(isGuardedTimeout(err), 'timed out');
    }
    // Past the grandchild's 3s write deadline: if it were alive, the marker exists.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    assert.equal(fs.existsSync(marker), false, 'the grandchild was reaped before it could write the marker');
    fs.rmSync(marker, { force: true });
  });
});
