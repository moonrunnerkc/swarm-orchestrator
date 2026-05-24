// Tests for the v2.0 mock-of-hallucination registry probe.

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import {
  buildMockOfHallucinationDetector,
  mockOfHallucinationDetector,
} from '../../../src/audit/cheat-detector/mock-of-hallucination';
import { CachingRegistryProbe } from '../../../src/audit/cheat-detector/registries/cache';
import { OfflineAllowlistProbe } from '../../../src/audit/cheat-detector/registries/offline-allowlist';
import type {
  ProbeQuery,
  ProbeResult,
  RegistryProbe,
} from '../../../src/audit/cheat-detector/registries/types';
import type { Finding } from '../../../src/audit/types';

function run(diff: string, repoRoot?: string): Finding[] {
  return mockOfHallucinationDetector.run({
    files: parseDiff(diff),
    repoRoot: repoRoot ?? '.',
  }) as Finding[];
}

describe('mock-of-hallucination v2.0', () => {
  it('declares a 2.x detector version', () => {
    assert.ok(mockOfHallucinationDetector.version.startsWith('2.'));
  });

  it('blocks actions/checkout@v6 (the v10.1 missed hallucination case)', async () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,2 +1,3 @@
 steps:
+  - uses: actions/checkout@v6
   - run: npm test
`;
    const findings = run(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'block');
    assert.match(findings[0]!.message, /actions\/checkout@v6/);
    assert.match(findings[0]!.message, /highest known version/);
  });

  it('does NOT fire on actions/checkout@v4 (a real, supported version)', async () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,2 +1,3 @@
 steps:
+  - uses: actions/checkout@v4
   - run: npm test
`;
    const findings = run(diff);
    assert.equal(findings.length, 0);
  });

  it('emits an info finding for an unknown action (not in the allowlist)', async () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,1 +1,2 @@
 steps:
+  - uses: example-org/some-private-action@v1
`;
    const findings = run(diff);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'info');
    assert.match(findings[0]!.message, /not in the offline allowlist/);
  });

  it('keeps blocking mocks against modules not in any manifest', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-mockv2-'));
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ dependencies: {} }));
    const diff = `diff --git a/src/x.test.ts b/src/x.test.ts
--- a/src/x.test.ts
+++ b/src/x.test.ts
@@ -1,2 +1,3 @@
 import { foo } from './x';
+jest.mock('nonexistent-pkg-9000');
 test('foo', () => {});
`;
    const findings = run(diff, repo);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'block');
  });

  it('annotates a manifest-miss with a probe-recognized hint when the registry knows the package', () => {
    // Empty manifest, but the registry probe knows lodash exists.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-mockv2-'));
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ dependencies: {} }));
    const diff = `diff --git a/src/x.test.ts b/src/x.test.ts
--- a/src/x.test.ts
+++ b/src/x.test.ts
@@ -1,2 +1,3 @@
 import { foo } from './x';
+jest.mock('lodash');
 test('foo', () => {});
`;
    const findings = run(diff, repo);
    assert.equal(findings.length, 1);
    // Severity stays at block (synthetic regression contract);
    // the message gains a "registry recognized" hint so a reviewer
    // can downgrade manually.
    assert.equal(findings[0]!.severity, 'block');
    assert.match(findings[0]!.message, /registry probe recognized/);
  });

  it('caching probe collapses repeated lookups into a single underlying call', async () => {
    let calls = 0;
    const fakeProbe: RegistryProbe = {
      snapshotDate: () => '2026-01-01',
      query: (_q: ProbeQuery): ProbeResult => {
        calls += 1;
        return {
          verdict: 'unknown',
          diagnostic: 'fake unknown',
          snapshotDate: '2026-01-01',
          fromNetwork: false,
        };
      },
    };
    const caching = new CachingRegistryProbe(fakeProbe);
    await caching.query({ registry: 'npm', name: 'foo' });
    await caching.query({ registry: 'npm', name: 'foo' });
    await caching.query({ registry: 'npm', name: 'foo' });
    assert.equal(calls, 1);
    assert.equal(caching.size(), 1);
  });

  it('OfflineAllowlistProbe recognizes a known npm package', () => {
    const probe = new OfflineAllowlistProbe();
    const out = probe.query({ registry: 'npm', name: 'lodash' });
    assert.equal(out.verdict, 'known');
    assert.equal(out.fromNetwork, false);
  });

  it('OfflineAllowlistProbe flags a past-max version of a known action', () => {
    const probe = new OfflineAllowlistProbe();
    const out = probe.query({ registry: 'github-actions', name: 'actions/checkout', version: 'v99' });
    assert.equal(out.verdict, 'unknown-version-of-known-package');
  });

  it('OfflineAllowlistProbe accepts a within-range version', () => {
    const probe = new OfflineAllowlistProbe();
    const out = probe.query({ registry: 'github-actions', name: 'actions/checkout', version: 'v4' });
    assert.equal(out.verdict, 'known');
  });

  it('custom probe injection is honored via buildMockOfHallucinationDetector', async () => {
    const allKnownProbe: RegistryProbe = {
      snapshotDate: () => '2026-01-01',
      query: () => ({
        verdict: 'known',
        diagnostic: 'all known stub',
        snapshotDate: '2026-01-01',
        fromNetwork: false,
      }),
    };
    const detector = buildMockOfHallucinationDetector({ registryProbe: allKnownProbe });
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,1 +1,2 @@
 steps:
+  - uses: actions/checkout@v6
`;
    const out = await detector.run({ files: parseDiff(diff), repoRoot: '.' });
    const findings = Array.isArray(out) ? out : await out;
    assert.equal(findings.length, 0);
  });
});
