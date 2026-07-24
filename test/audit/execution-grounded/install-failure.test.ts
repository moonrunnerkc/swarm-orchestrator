import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  captureInstallFailure,
  classifyInstallFailure,
  redactSecrets,
  stderrTail,
  SandboxInstallError,
  STDERR_TAIL_LINES,
  STDERR_TAIL_MAX_BYTES,
  type InstallFailureEvidence,
} from '../../../src/audit/execution-grounded/install-failure';
import { detectLockfileName, readNodeEngineRange } from '../../../src/audit/execution-grounded/sandbox';
import { nonNodeLockfileName } from '../../../src/audit/execution-grounded/polyglot-install';
import { deriveProvisioning } from '../../../src/audit/attestation/engine-projection';
import { SwarmError } from '../../../src/errors';

function evidence(stderr: string, overrides: Partial<InstallFailureEvidence> = {}): InstallFailureEvidence {
  return {
    packageManager: 'npm',
    exitCode: 1,
    timedOut: false,
    stderrTail: stderr,
    lockfile: 'package-lock.json',
    nodeEngineRange: null,
    ...overrides,
  };
}

describe('classifyInstallFailure', () => {
  it('buckets a DNS failure against the registry as registry-or-network', () => {
    const stderr = [
      'npm error code ENOTFOUND',
      'npm error errno ENOTFOUND',
      'npm error network request to https://registry.npmjs.org/react failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org',
      'npm error network This is a problem related to network connectivity.',
    ].join('\n');
    assert.equal(classifyInstallFailure(evidence(stderr)), 'registry-or-network');
  });

  it('buckets a missing registry package (E404) as registry-or-network', () => {
    const stderr = [
      'npm error code E404',
      "npm error 404 Not Found - GET https://registry.npmjs.org/@acme%2finternal-tool - Not found",
      "npm error 404 '@acme/internal-tool@^2.0.0' is not in this registry.",
    ].join('\n');
    assert.equal(classifyInstallFailure(evidence(stderr)), 'registry-or-network');
  });

  it('buckets a node-gyp compile failure as native-build', () => {
    const stderr = [
      'gyp info spawn make',
      "make: Entering directory '/w/node_modules/canvas/build'",
      '../src/Canvas.cc:23:10: fatal error: cairo.h: No such file or directory',
      'make: *** [Release/obj.target/canvas/src/Canvas.o] Error 1',
      'gyp ERR! build error',
      'gyp ERR! stack Error: `make` failed with exit code: 2',
    ].join('\n');
    assert.equal(classifyInstallFailure(evidence(stderr)), 'native-build');
  });

  it('buckets a node-gyp failure inside a postinstall script as native-build, not lifecycle', () => {
    const stderr = [
      'npm error command sh -c node-gyp rebuild',
      'gyp ERR! configure error',
      'gyp ERR! stack Error: Python executable not found',
    ].join('\n');
    assert.equal(classifyInstallFailure(evidence(stderr)), 'native-build');
  });

  it('buckets an npm EBADENGINE refusal as engines-mismatch', () => {
    const stderr = [
      'npm error code EBADENGINE',
      'npm error engine Unsupported engine',
      'npm error engine Not compatible with your version of node/npm: some-pkg@3.0.0',
      "npm error notsup Required: {'node':'>=24'}",
    ].join('\n');
    assert.equal(classifyInstallFailure(evidence(stderr)), 'engines-mismatch');
  });

  it('buckets a yarn engine refusal as engines-mismatch', () => {
    const stderr =
      'error some-pkg@1.2.3: The engine "node" is incompatible with this module. Expected version ">=24.0.0". Got "22.12.0"';
    assert.equal(classifyInstallFailure(evidence(stderr, { packageManager: 'yarn' })), 'engines-mismatch');
  });

  it('buckets an ERESOLVE dependency-tree conflict as peer-dep-conflict', () => {
    const stderr = [
      'npm error code ERESOLVE',
      'npm error ERESOLVE unable to resolve dependency tree',
      'npm error peer react@"^17.0.0" from react-dom@17.0.2',
      'npm error Conflicting peer dependency: react@17.0.2',
    ].join('\n');
    assert.equal(classifyInstallFailure(evidence(stderr)), 'peer-dep-conflict');
  });

  it('buckets an npm lifecycle-script failure as lifecycle-script', () => {
    const stderr = [
      'npm error code 1',
      'npm error path /w/node_modules/husky-consumer',
      'npm error command failed',
      'npm error command sh -c husky install',
      'npm error sh: 1: husky: not found',
    ].join('\n');
    assert.equal(classifyInstallFailure(evidence(stderr)), 'lifecycle-script');
  });

  it('buckets an ELIFECYCLE failure as lifecycle-script', () => {
    const stderr = 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1\nnpm ERR! some-pkg@1.0.0 postinstall: `node scripts/setup.js`';
    assert.equal(classifyInstallFailure(evidence(stderr)), 'lifecycle-script');
  });

  it('buckets an npm hit on the workspace: protocol as workspace-protocol', () => {
    const stderr = [
      'npm error code EUNSUPPORTEDPROTOCOL',
      'npm error Unsupported URL Type "workspace:": workspace:*',
    ].join('\n');
    assert.equal(classifyInstallFailure(evidence(stderr)), 'workspace-protocol');
  });

  it('buckets an out-of-disk failure as disk-or-timeout', () => {
    const stderr = "npm error code ENOSPC\nnpm error nospc ENOSPC: no space left on device, write";
    assert.equal(classifyInstallFailure(evidence(stderr)), 'disk-or-timeout');
  });

  it('buckets a guarded-runner timeout as disk-or-timeout regardless of stderr', () => {
    const stderr = 'npm error code ERESOLVE';
    assert.equal(
      classifyInstallFailure(evidence(stderr, { timedOut: true, exitCode: null })),
      'disk-or-timeout',
    );
  });

  it('buckets unrecognized stderr as other', () => {
    assert.equal(classifyInstallFailure(evidence('some entirely novel failure text')), 'other');
    assert.equal(classifyInstallFailure(evidence('')), 'other');
  });

  it('is deterministic: the same evidence always yields the same bucket', () => {
    const e = evidence('gyp ERR! build error');
    assert.equal(classifyInstallFailure(e), classifyInstallFailure(e));
  });
});

describe('stderrTail', () => {
  it('keeps only the last 40 lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const tail = stderrTail(lines.join('\n'));
    const kept = tail.split('\n');
    assert.equal(kept.length, STDERR_TAIL_LINES);
    assert.equal(kept[0], 'line 60');
    assert.equal(kept[kept.length - 1], 'line 99');
  });

  it('caps the tail at the byte limit, keeping the end', () => {
    const big = Array.from({ length: 40 }, () => 'x'.repeat(1000)).join('\n') + '\nEND-MARKER';
    const tail = stderrTail(big);
    assert.ok(Buffer.byteLength(tail, 'utf8') <= STDERR_TAIL_MAX_BYTES);
    assert.ok(tail.endsWith('END-MARKER'));
  });

  it('returns an empty string for empty stderr', () => {
    assert.equal(stderrTail(''), '');
  });
});

describe('redactSecrets', () => {
  it('masks registry URL userinfo', () => {
    const out = redactSecrets('fetch failed https://user:s3cr3t@registry.corp.example/pkg');
    assert.ok(!out.includes('s3cr3t'));
    assert.ok(out.includes('https://***@registry.corp.example/pkg'));
  });

  it('masks _authToken lines and bearer authorization headers', () => {
    const out = redactSecrets(
      '//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789\nauthorization: Bearer eyJhbGciOi',
    );
    assert.ok(!out.includes('npm_abcdefghijklmnopqrstuvwxyz0123456789'));
    assert.ok(!out.includes('eyJhbGciOi'));
  });

  it('masks GitHub token shapes', () => {
    const out = redactSecrets('remote: Invalid credentials ghp_abcdefghijklmnopqrstuvwx1234567890');
    assert.ok(!out.includes('ghp_abcdefghijklmnopqrstuvwx1234567890'));
  });

  it('masks generic key=value secrets while keeping the key name', () => {
    const out = redactSecrets('NODE_AUTH_TOKEN=deadbeefcafe and api_key: hunter2');
    assert.ok(!out.includes('deadbeefcafe'));
    assert.ok(!out.includes('hunter2'));
    assert.ok(/api_key/i.test(out));
  });
});

describe('captureInstallFailure', () => {
  function guardedErr(fields: { stderr: string; status: number | null; timedOut?: boolean }): Error {
    return Object.assign(new Error('npm exited with status 1'), {
      stderr: fields.stderr,
      status: fields.status,
      timedOut: fields.timedOut ?? false,
      signal: null,
      stdout: '',
    });
  }

  it('extracts exit code, stderr tail, and context into a classified record', () => {
    const err = guardedErr({ stderr: 'npm error code ERESOLVE\nnpm error unable to resolve dependency tree', status: 1 });
    const rec = captureInstallFailure(err, {
      packageManager: 'npm',
      lockfile: 'package-lock.json',
      nodeEngineRange: '>=20',
    });
    assert.equal(rec.bucket, 'peer-dep-conflict');
    assert.equal(rec.exitCode, 1);
    assert.equal(rec.timedOut, false);
    assert.equal(rec.packageManager, 'npm');
    assert.equal(rec.lockfile, 'package-lock.json');
    assert.equal(rec.nodeEngineRange, '>=20');
    assert.ok(rec.stderrTail.includes('ERESOLVE'));
  });

  it('records a timeout with a null exit code as disk-or-timeout', () => {
    const err = guardedErr({ stderr: '', status: null, timedOut: true });
    const rec = captureInstallFailure(err, { packageManager: 'pnpm', lockfile: 'pnpm-lock.yaml', nodeEngineRange: null });
    assert.equal(rec.bucket, 'disk-or-timeout');
    assert.equal(rec.exitCode, null);
    assert.equal(rec.timedOut, true);
  });

  it('redacts a token echoed in stderr before it reaches the record', () => {
    const err = guardedErr({
      stderr: 'npm error 403 Forbidden https://ci:ghp_abcdefghijklmnopqrstuvwx1234567890@registry.corp.example/x',
      status: 1,
    });
    const rec = captureInstallFailure(err, { packageManager: 'npm', lockfile: null, nodeEngineRange: null });
    assert.ok(!rec.stderrTail.includes('ghp_abcdefghijklmnopqrstuvwx1234567890'));
    assert.equal(rec.bucket, 'registry-or-network');
  });

  it('tolerates a non-Error throw', () => {
    const rec = captureInstallFailure('spawn failed', { packageManager: 'bun', lockfile: 'bun.lockb', nodeEngineRange: null });
    assert.equal(rec.exitCode, null);
    assert.equal(rec.stderrTail, '');
    assert.equal(rec.bucket, 'other');
  });
});

describe('SandboxInstallError', () => {
  it('keeps the sandbox-install-failed code and carries the classified record', () => {
    const rec = captureInstallFailure(new Error('x'), { packageManager: 'npm', lockfile: null, nodeEngineRange: null });
    const err = new SandboxInstallError('dependency install (npm ci) failed in /w', {
      remediation: 'Record it as yellow or red in stryker-viability.json.',
      cause: new Error('stderr'),
      installFailure: rec,
    });
    assert.ok(err instanceof SwarmError);
    assert.equal(err.code, 'sandbox-install-failed');
    assert.equal(err.installFailure.bucket, 'other');
    assert.ok(err.remediation !== undefined);
    assert.ok(err.cause instanceof Error);
  });
});

describe('install-failure workspace context helpers', () => {
  function tmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'install-failure-ctx-'));
  }

  it('detectLockfileName reports the lockfile detectPackageManager keyed on', () => {
    const dir = tmp();
    assert.equal(detectLockfileName(dir), null);
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '# yarn lockfile v1\n');
    assert.equal(detectLockfileName(dir), 'yarn.lock');
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    assert.equal(detectLockfileName(dir), 'pnpm-lock.yaml');
  });

  it('readNodeEngineRange reads engines.node and tolerates its absence', () => {
    const dir = tmp();
    assert.equal(readNodeEngineRange(dir), null);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    assert.equal(readNodeEngineRange(dir), null);
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', engines: { node: '>=20 <23' } }),
    );
    assert.equal(readNodeEngineRange(dir), '>=20 <23');
  });

  it('nonNodeLockfileName resolves go.sum, poetry.lock, and requirements.txt', () => {
    const dir = tmp();
    assert.equal(nonNodeLockfileName(dir, 'go'), null);
    fs.writeFileSync(path.join(dir, 'go.sum'), '');
    assert.equal(nonNodeLockfileName(dir, 'go'), 'go.sum');
    assert.equal(nonNodeLockfileName(dir, 'python'), null);
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'flask==3.0.0\n');
    assert.equal(nonNodeLockfileName(dir, 'python'), 'requirements.txt');
    fs.writeFileSync(path.join(dir, 'poetry.lock'), '');
    assert.equal(nonNodeLockfileName(dir, 'python'), 'poetry.lock');
  });
});

describe('deriveProvisioning with install-failure evidence', () => {
  it('attaches the record to a provision-failed status', () => {
    const rec = captureInstallFailure(new Error('x'), { packageManager: 'npm', lockfile: null, nodeEngineRange: null });
    const status = deriveProvisioning(['provision: sandbox-install-failed: npm ci failed'], rec);
    assert.equal(status.provisioned, false);
    assert.deepEqual(status.installFailure, rec);
  });

  it('omits the key entirely when no evidence exists, so old shapes are unchanged', () => {
    const status = deriveProvisioning(['provision: sandbox-clone-failed: unreachable']);
    assert.equal(status.provisioned, false);
    assert.ok(!('installFailure' in status));
    const ok = deriveProvisioning([]);
    assert.deepEqual(ok, { attempted: true, provisioned: true });
  });
});
