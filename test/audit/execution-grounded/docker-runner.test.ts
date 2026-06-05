import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildDockerRunArgs,
  dockerAvailable,
  dockerImagePresent,
  dockerSandboxNetwork,
  dockerSkipReason,
} from '../../../src/audit/execution-grounded/docker-runner';
import { execFileGuarded } from '../../../src/audit/execution-grounded/exec-env';

describe('execution-grounded / docker-runner', () => {
  describe('buildDockerRunArgs', () => {
    it('builds a locked-down run: --rm, network, single checkout bind, workdir, env, entrypoint', () => {
      const argv = buildDockerRunArgs({
        image: 'swarm-orchestrator:audit',
        network: 'none',
        checkoutDir: '/work/eg-abc',
        workdir: '/work/eg-abc',
        env: { CI: 'true', BROWSER: 'none' },
        user: '1000:1000',
        bin: 'npx',
        args: ['stryker', 'run', 'cfg.json'],
      });
      assert.deepEqual(argv, [
        'run',
        '--rm',
        '--network',
        'none',
        '--user',
        '1000:1000',
        '-v',
        '/work/eg-abc:/work/eg-abc',
        '-w',
        '/work/eg-abc',
        '-e',
        'CI=true',
        '-e',
        'BROWSER=none',
        '--entrypoint',
        'npx',
        'swarm-orchestrator:audit',
        'stryker',
        'run',
        'cfg.json',
      ]);
    });

    it('binds only the checkout directory, nothing else from the host', () => {
      const argv = buildDockerRunArgs({
        image: 'img',
        network: 'none',
        checkoutDir: '/tmp/checkout',
        workdir: '/tmp/checkout',
        env: {},
        bin: 'node',
        args: ['x.js'],
      });
      const binds = argv.filter((_, i) => argv[i - 1] === '-v');
      assert.deepEqual(binds, ['/tmp/checkout:/tmp/checkout']);
    });

    it('omits --user when no uid is supplied', () => {
      const argv = buildDockerRunArgs({
        image: 'img',
        network: 'none',
        checkoutDir: '/c',
        workdir: '/c',
        env: {},
        bin: 'node',
        args: [],
      });
      assert.equal(argv.includes('--user'), false);
    });
  });

  describe('dockerSandboxNetwork', () => {
    const SAVED = process.env.SWARM_EG_DOCKER_NETWORK;
    afterEach(() => {
      if (SAVED === undefined) delete process.env.SWARM_EG_DOCKER_NETWORK;
      else process.env.SWARM_EG_DOCKER_NETWORK = SAVED;
    });
    it('locks to none by default and honors the override', () => {
      delete process.env.SWARM_EG_DOCKER_NETWORK;
      assert.equal(dockerSandboxNetwork(), 'none');
      process.env.SWARM_EG_DOCKER_NETWORK = 'bridge';
      assert.equal(dockerSandboxNetwork(), 'bridge');
    });
  });

  describe('dockerSkipReason', () => {
    it('is null when the host runner is requested', () => {
      assert.equal(
        dockerSkipReason({ runnerRequested: false, dockerOk: false, imageOk: false, image: 'img' }),
        null,
      );
    });
    it('reports when docker was requested but the daemon is down', () => {
      const reason = dockerSkipReason({ runnerRequested: true, dockerOk: false, imageOk: false, image: 'img' });
      assert.ok(reason !== null && /docker daemon is not available/.test(reason));
      assert.ok(reason !== null && /no host fallback/.test(reason), 'never silently falls back to host');
    });
    it('reports a missing image with a build hint', () => {
      const reason = dockerSkipReason({ runnerRequested: true, dockerOk: true, imageOk: false, image: 'swarm:audit' });
      assert.ok(reason !== null && /docker build -t swarm:audit/.test(reason));
    });
    it('is null when docker and the image are both available', () => {
      assert.equal(
        dockerSkipReason({ runnerRequested: true, dockerOk: true, imageOk: true, image: 'img' }),
        null,
      );
    });
  });

  describe('dockerAvailable / dockerImagePresent', () => {
    it('returns false for a docker binary that does not exist', () => {
      assert.equal(dockerAvailable('definitely-not-a-real-docker-binary-xyz'), false);
      assert.equal(dockerImagePresent('whatever', 'definitely-not-a-real-docker-binary-xyz'), false);
    });
  });

  // A real container run, only when docker is actually up. Proves the seam end
  // to end: execFileGuarded with a docker context runs the command inside the
  // container under --network none, with the headless env injected, and
  // surfaces the container's exit code (zero passes, non-zero throws). The
  // host-side bind-mount writeback that real mutation/coverage runs depend on
  // is native-docker behavior, not asserted here because it varies with the
  // daemon's mount setup (see SECURITY.md).
  const liveDocker = dockerAvailable() && dockerImagePresent('alpine:latest');
  (liveDocker ? it : it.skip)('runs in a container with the injected env and surfaces the exit code', function () {
    this.timeout(60_000);
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-eg-docker-'));
    fs.chmodSync(checkout, 0o777);
    const docker = { image: 'alpine:latest', network: 'none' };
    const hostEnv = { PATH: process.env.PATH ?? '' };
    try {
      // The container asserts CI=true (injected by dockerInjectEnv) via its exit
      // code; a clean exit means the env crossed the boundary and it ran.
      execFileGuarded('sh', ['-c', 'test "$CI" = "true"'], {
        cwd: checkout,
        env: hostEnv,
        timeoutMs: 30_000,
        docker,
      });
      // A non-zero exit inside the container propagates as a throw.
      assert.throws(
        () => execFileGuarded('sh', ['-c', 'exit 3'], { cwd: checkout, env: hostEnv, timeoutMs: 30_000, docker }),
        /exited with status 3/,
      );
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });
});
