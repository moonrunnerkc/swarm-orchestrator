import { strict as assert } from 'assert';
import * as path from 'path';
import { execEnv } from '../../../src/audit/execution-grounded/exec-env';

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
