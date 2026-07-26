import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { provisionWorkspace, resolveSubdirManifest } from '../../../src/audit/execution-grounded/sandbox';
import { SandboxInstallError } from '../../../src/audit/execution-grounded/install-failure';

// Real behavior, offline: each case builds a local git repo, points the
// fail-closed SWARM_PR_FIXTURE_DIR seam at it, and runs the real provisioner
// (real git fetch/checkout, real npm ci). The lockfiles declare zero
// dependencies so the installs never touch the network.

// One in-repo file: dependency, so a successful npm ci observably creates
// node_modules/fixture-dep in the directory it ran in, with zero network.
const MINIMAL_LOCKFILE = (name: string): string =>
  JSON.stringify({
    name,
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name, version: '1.0.0', dependencies: { 'fixture-dep': 'file:dep-local' } },
      'dep-local': { name: 'fixture-dep', version: '1.0.0' },
      'node_modules/fixture-dep': { resolved: 'dep-local', link: true },
    },
  });

const APP_PACKAGE = JSON.stringify({
  name: 'fixture-app',
  version: '1.0.0',
  scripts: { test: 'node --test' },
  dependencies: { 'fixture-dep': 'file:dep-local' },
});

const DEP_PACKAGE = JSON.stringify({ name: 'fixture-dep', version: '1.0.0' });

interface Fixture {
  fixtureDir: string;
  repo: string;
  headSha: string;
  cleanup: () => void;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Build a one-commit local git repo carrying `files`, wrapped in a fixture dir
 *  the SWARM_PR_FIXTURE_DIR seam accepts for `repo`. */
function makeFixture(repo: string, files: Record<string, string>): Fixture {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-manifest-fixture-'));
  const repoDir = path.join(fixtureDir, 'repo');
  fs.mkdirSync(repoDir);
  git(repoDir, 'init', '-q');
  git(repoDir, 'config', 'user.email', 'fixture@test.invalid');
  git(repoDir, 'config', 'user.name', 'fixture');
  git(repoDir, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'fixture head');
  const headSha = git(repoDir, 'rev-parse', 'HEAD');
  fs.writeFileSync(
    path.join(fixtureDir, 'fixture.json'),
    JSON.stringify({
      repo,
      number: 1,
      title: 'fixture',
      body: '',
      author: 'fixture',
      headRef: 'main',
      headSha,
      baseSha: headSha,
    }),
  );
  return {
    fixtureDir,
    repo,
    headSha,
    cleanup: () => fs.rmSync(fixtureDir, { recursive: true, force: true }),
  };
}

/** Run `fn` with the fixture seam pointed at `fixtureDir`, restoring the env. */
function withFixtureEnv<T>(fixtureDir: string, fn: () => T): T {
  const prior = process.env.SWARM_PR_FIXTURE_DIR;
  process.env.SWARM_PR_FIXTURE_DIR = fixtureDir;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env.SWARM_PR_FIXTURE_DIR;
    else process.env.SWARM_PR_FIXTURE_DIR = prior;
  }
}

describe('execution-grounded / sandbox subdirectory-manifest provisioning', function () {
  this.timeout(120_000);

  it('provisions at the root exactly as before when the root has a manifest', () => {
    const fx = makeFixture('fixture/root-app', {
      'package.json': APP_PACKAGE,
      'package-lock.json': MINIMAL_LOCKFILE('fixture-app'),
      'dep-local/package.json': DEP_PACKAGE,
      'src/index.js': 'module.exports = 1;\n',
    });
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-manifest-ws-'));
    try {
      const ws = withFixtureEnv(fx.fixtureDir, () =>
        provisionWorkspace({
          repo: fx.repo,
          commit: fx.headSha,
          baseDir,
          changedFiles: ['src/index.js'],
        }),
      );
      try {
        assert.equal(ws.manifestDir, '');
        assert.equal(ws.packageManager, 'npm');
        assert.equal(ws.testRunner, 'node-test');
        assert.ok(fs.existsSync(path.join(ws.workspacePath, 'node_modules')), 'npm ci ran at the root');
      } finally {
        ws.cleanup();
      }
    } finally {
      fx.cleanup();
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('installs in the subdirectory whose manifest owns the changed files', () => {
    const fx = makeFixture('fixture/subdir-app', {
      'README.md': '# no root manifest\n',
      'app/package.json': APP_PACKAGE,
      'app/package-lock.json': MINIMAL_LOCKFILE('fixture-app'),
      'app/dep-local/package.json': DEP_PACKAGE,
      'app/src/index.js': 'module.exports = 1;\n',
      'docs/notes.md': 'unowned\n',
    });
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-manifest-ws-'));
    try {
      const ws = withFixtureEnv(fx.fixtureDir, () =>
        provisionWorkspace({
          repo: fx.repo,
          commit: fx.headSha,
          baseDir,
          changedFiles: ['app/src/index.js'],
        }),
      );
      try {
        assert.equal(ws.manifestDir, 'app');
        assert.equal(ws.packageManager, 'npm');
        assert.equal(ws.testRunner, 'node-test', 'runner detected at the chosen manifest dir');
        assert.ok(
          fs.existsSync(path.join(ws.workspacePath, 'app', 'node_modules')),
          'npm ci ran inside app/, not the manifest-less root',
        );
      } finally {
        ws.cleanup();
      }
    } finally {
      fx.cleanup();
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('refuses with no-manifest-for-diff when no discovered manifest owns a changed file', () => {
    const fx = makeFixture('fixture/subdir-unowned', {
      'README.md': '# no root manifest\n',
      'app/package.json': APP_PACKAGE,
      'app/package-lock.json': MINIMAL_LOCKFILE('fixture-app'),
      'docs/notes.md': 'the diff lives here\n',
    });
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-manifest-ws-'));
    try {
      assert.throws(
        () =>
          withFixtureEnv(fx.fixtureDir, () =>
            provisionWorkspace({
              repo: fx.repo,
              commit: fx.headSha,
              baseDir,
              changedFiles: ['docs/notes.md'],
            }),
          ),
        (err: unknown) =>
          err instanceof SandboxInstallError && err.installFailure.bucket === 'no-manifest-for-diff',
      );
    } finally {
      fx.cleanup();
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('refuses with no-manifest-found when the repo has no manifest anywhere', () => {
    const fx = makeFixture('fixture/no-manifest', {
      'README.md': '# nothing to install\n',
      'scripts/run.sh': 'echo hi\n',
    });
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-manifest-ws-'));
    try {
      assert.throws(
        () =>
          withFixtureEnv(fx.fixtureDir, () =>
            provisionWorkspace({
              repo: fx.repo,
              commit: fx.headSha,
              baseDir,
              changedFiles: ['scripts/run.sh'],
            }),
          ),
        (err: unknown) =>
          err instanceof SandboxInstallError && err.installFailure.bucket === 'no-manifest-found',
      );
    } finally {
      fx.cleanup();
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('resolveSubdirManifest routes a Go subdirectory module through the same discovery', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-manifest-go-'));
    try {
      fs.mkdirSync(path.join(root, 'service'), { recursive: true });
      fs.writeFileSync(path.join(root, 'service', 'go.mod'), 'module example.com/service\n\ngo 1.22\n');
      fs.writeFileSync(path.join(root, 'README.md'), '');
      assert.equal(resolveSubdirManifest(root, ['service/main.go']), 'service');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
