import { strict as assert } from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sha256File, sha256FileIfPresent } from '../../../src/audit/evidence-pack/hashing';

function writeTemp(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-hash-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

describe('evidence-pack / hashing', () => {
  it('sha256File matches a reference digest of the same bytes', () => {
    const file = writeTemp('a.json', '{"x":1}\n');
    const expected = crypto.createHash('sha256').update('{"x":1}\n').digest('hex');
    assert.equal(sha256File(file), expected);
  });

  it('sha256File throws a SwarmError with remediation when the file is missing', () => {
    assert.throws(
      () => sha256File(path.join(os.tmpdir(), 'does-not-exist-swarm.json')),
      /could not read evidence file/,
    );
  });

  it('sha256FileIfPresent returns the digest for an existing file', () => {
    const file = writeTemp('b.txt', 'coverage-final');
    assert.equal(sha256FileIfPresent(file), sha256File(file));
  });

  it('sha256FileIfPresent returns undefined for a missing or undefined path', () => {
    assert.equal(sha256FileIfPresent(undefined), undefined);
    assert.equal(sha256FileIfPresent(path.join(os.tmpdir(), 'nope-swarm.json')), undefined);
  });
});
