import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CONTRACT_FILENAME,
  MANIFEST_FILENAME,
  parseJsonl,
  readContract,
  writeContract,
} from '../../src/contract/serializer';
import { type FinalContract } from '../../src/contract/types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contract-serializer-'));
}

function sampleContract(): FinalContract {
  return {
    manifest: {
      schemaVersion: 'v1',
      contractHash: 'a'.repeat(64),
      contractId: 'a'.repeat(16),
      goal: 'add a health check endpoint',
      repoContext: {
        repoRoot: '/tmp/example',
        buildCommand: 'npm run build',
        testCommand: 'npm test',
        language: 'typescript',
      },
      extractor: {
        name: 'stub',
        model: null,
        temperature: null,
        promptSha256: null,
      },
      createdAt: '2026-05-08T00:00:00.000Z',
    },
    obligations: [
      { type: 'file-must-exist', path: 'src/health.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
  };
}

describe('contract/serializer', () => {
  describe('parseJsonl', () => {
    it('parses one obligation per line', () => {
      const text =
        '{"type":"file-must-exist","path":"a.ts"}\n' +
        '{"type":"build-must-pass","command":"npm run build"}\n';
      const out = parseJsonl(text);
      assert.equal(out.length, 2);
    });

    it('skips blank lines', () => {
      const text =
        '\n\n{"type":"file-must-exist","path":"a.ts"}\n\n' +
        '{"type":"build-must-pass","command":"npm run build"}\n\n';
      assert.equal(parseJsonl(text).length, 2);
    });

    it('throws on a non-blank invalid line', () => {
      assert.throws(() => parseJsonl('{not json}\n'), /not valid JSON/);
    });
  });

  describe('writeContract / readContract', () => {
    it('roundtrips a finalized contract', () => {
      const dir = tmpDir();
      try {
        const original = sampleContract();
        writeContract(dir, original);
        assert.ok(fs.existsSync(path.join(dir, CONTRACT_FILENAME)));
        assert.ok(fs.existsSync(path.join(dir, MANIFEST_FILENAME)));
        const reread = readContract(dir);
        assert.deepEqual(reread.obligations, original.obligations);
        assert.deepEqual(reread.manifest, original.manifest);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects a manifest with an unknown schemaVersion', () => {
      const dir = tmpDir();
      try {
        const c = sampleContract();
        writeContract(dir, c);
        const manifestPath = path.join(dir, MANIFEST_FILENAME);
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        m.schemaVersion = 'v999';
        fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n', 'utf8');
        assert.throws(() => readContract(dir), /schemaVersion "v999"/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects a contract.jsonl that fails validation', () => {
      const dir = tmpDir();
      try {
        const c = sampleContract();
        writeContract(dir, c);
        // overwrite with only a file obligation (missing build + test)
        fs.writeFileSync(
          path.join(dir, CONTRACT_FILENAME),
          '{"type":"file-must-exist","path":"a.ts"}\n',
          'utf8',
        );
        assert.throws(() => readContract(dir), /failed validation/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('throws when contract.jsonl is missing', () => {
      const dir = tmpDir();
      try {
        assert.throws(() => readContract(dir), /not found/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
