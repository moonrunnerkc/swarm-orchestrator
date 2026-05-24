import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The tests target the built CLI under `dist/src/cli.js` (mocha runs after build).
const CLI_RESOLVED = path.resolve(__dirname, '..', '..', '..', 'dist', 'src', 'cli.js');

function runCli(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const res = spawnSync('node', [CLI_RESOLVED, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    exitCode: res.status ?? 1,
  };
}

const TEST_RELAXATION_DIFF = `diff --git a/src/feat.test.ts b/src/feat.test.ts
--- a/src/feat.test.ts
+++ b/src/feat.test.ts
@@ -1,3 +1,3 @@
 it('feat', () => {
-  expect(value).toBe(5);
+  expect(value).toBeDefined();
 });
`;

const CLEAN_DIFF = `diff --git a/src/lib.ts b/src/lib.ts
--- a/src/lib.ts
+++ b/src/lib.ts
@@ -1,2 +1,3 @@
 export function f(x: number): number {
+  if (x < 0) return -1;
   return x;
 }
diff --git a/src/lib.test.ts b/src/lib.test.ts
--- a/src/lib.test.ts
+++ b/src/lib.test.ts
@@ -1,1 +1,2 @@
 it('positive', () => { expect(f(1)).toBe(1); });
+it('negative', () => { expect(f(-1)).toBe(-1); });
`;

describe('cli / swarm audit', function () {
  this.timeout(15_000);

  it('returns exit 1 with json output for a test-relaxation diff (gate mode + experimental set)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cli-audit-'));
    const diffFile = path.join(dir, 'in.patch');
    fs.writeFileSync(diffFile, TEST_RELAXATION_DIFF);
    const { stdout, exitCode } = runCli(
      [
        'audit',
        '--diff-file', diffFile,
        '--repo-root', dir,
        '--output', 'json',
        '--mode', 'gate',
        '--detectors', 'experimental',
      ],
      dir,
    );
    assert.equal(exitCode, 1, `expected exit 1, got ${exitCode}`);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.pass, false);
    assert.ok(parsed.findings.some((f: { category: string }) => f.category === 'test-relaxation'));
  });

  it('defaults to advise mode: exit 0 even on a test-relaxation diff under experimental set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cli-audit-advise-'));
    const diffFile = path.join(dir, 'in.patch');
    fs.writeFileSync(diffFile, TEST_RELAXATION_DIFF);
    const { stdout, exitCode } = runCli(
      [
        'audit',
        '--diff-file', diffFile,
        '--repo-root', dir,
        '--output', 'json',
        '--detectors', 'experimental',
      ],
      dir,
    );
    assert.equal(exitCode, 0, `expected exit 0 in advise mode, got ${exitCode}`);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.mode, 'advise');
    assert.equal(parsed.pass, false);
  });

  it('returns exit 0 for a clean diff', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cli-audit-clean-'));
    const diffFile = path.join(dir, 'in.patch');
    fs.writeFileSync(diffFile, CLEAN_DIFF);
    const { exitCode } = runCli(
      ['audit', '--diff-file', diffFile, '--repo-root', dir, '--output', 'json'],
      dir,
    );
    assert.equal(exitCode, 0, `expected exit 0, got ${exitCode}`);
  });

  it('--emit-aibom cyclonedx-ml writes a valid CycloneDX file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cli-aibom-'));
    const diffFile = path.join(dir, 'in.patch');
    fs.writeFileSync(diffFile, TEST_RELAXATION_DIFF);
    const aibomDir = path.join(dir, 'aibom');
    runCli(
      [
        'audit',
        '--diff-file',
        diffFile,
        '--repo-root',
        dir,
        '--output',
        'json',
        '--mode',
        'gate',
        '--detectors',
        'experimental',
        '--emit-aibom',
        'cyclonedx-ml',
        '--aibom-out',
        aibomDir,
      ],
      dir,
    );
    const files = fs.readdirSync(aibomDir);
    const cdx = files.find((f) => f.endsWith('.cdx.json'));
    assert.ok(cdx !== undefined, `expected a .cdx.json file in ${aibomDir}; got ${files}`);
    const doc = JSON.parse(fs.readFileSync(path.join(aibomDir, cdx ?? ''), 'utf8'));
    assert.equal(doc.bomFormat, 'CycloneDX');
    assert.equal(doc.specVersion, '1.6');
  });

  it('--help prints usage and returns 0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cli-help-'));
    const { exitCode, stderr } = runCli(['audit', '--help'], dir);
    assert.equal(exitCode, 0);
    assert.ok(stderr.includes('usage: swarm audit'));
  });

  it('rejects missing input mode with exit 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cli-bad-'));
    const { exitCode } = runCli(['audit'], dir);
    assert.equal(exitCode, 2);
  });
});
