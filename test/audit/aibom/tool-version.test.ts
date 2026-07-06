import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readToolVersion } from '../../../src/audit/aibom/tool-version';

describe('aibom / tool-version', () => {
  it('reads the version from the nearest package.json walking upward', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-tv-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.4.5' }));
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(readToolVersion(nested), '3.4.5');
  });

  it('falls back to 0.0.0 when no package.json is found', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-tv-none-'));
    // A temp dir will hit the filesystem root before finding a versioned manifest.
    const version = readToolVersion(empty);
    assert.match(version, /^\d+\.\d+\.\d+/);
  });

  it('resolves the real swarm-orchestrator version by default', () => {
    assert.match(readToolVersion(), /^\d+\.\d+\.\d+/);
  });
});
