// Pins the deletion-ownership contract of oracle:build. The rebuild may
// clear only directories named after a registered injector category;
// sidecar directories (live-path-runs/) and sibling report files must
// survive. Regression test for the incident where a rebuild deleted the
// committed live-path-runs sidecar.

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ownedCategoryDirs, writeCases } from '../../../scripts/oracle/build-corpus';

describe('oracle / build-corpus deletion ownership', () => {
  it('owns exactly the registered injector categories, never sidecars', () => {
    const owned = ownedCategoryDirs();
    assert.ok(owned.has('mock-of-hallucination'));
    assert.ok(owned.has('goal-not-fixed'));
    assert.ok(!owned.has('live-path-runs'));
  });

  it('a rebuild spares sidecar directories and report files it does not own', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-corpus-'));
    const outRoot = path.join(root, 'benchmarks', 'oracle-corpus');
    fs.mkdirSync(path.join(outRoot, 'live-path-runs'), { recursive: true });
    fs.writeFileSync(path.join(outRoot, 'live-path-runs', 'sentinel.json'), '{}\n');
    fs.mkdirSync(path.join(outRoot, 'mock-of-hallucination', 'stale-injector'), {
      recursive: true,
    });
    fs.writeFileSync(path.join(outRoot, 'COVERAGE.md'), 'sentinel report\n');
    writeCases(root, []);
    assert.ok(
      fs.existsSync(path.join(outRoot, 'live-path-runs', 'sentinel.json')),
      'sidecar directory must survive a rebuild',
    );
    assert.ok(
      fs.existsSync(path.join(outRoot, 'COVERAGE.md')),
      'sibling report file must survive a rebuild',
    );
    assert.ok(
      !fs.existsSync(path.join(outRoot, 'mock-of-hallucination')),
      'registry-owned category directory must be cleared',
    );
  });
});
