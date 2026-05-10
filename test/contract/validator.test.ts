import { strict as assert } from 'assert';
import { validateObligations } from '../../src/contract/validator';

describe('contract/validator', () => {
  it('accepts a minimal valid contract (file + build + test)', () => {
    const result = validateObligations([
      { type: 'file-must-exist', path: 'src/health.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('accepts a behavioral-only contract (build + test, no file)', () => {
    const result = validateObligations([
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, true);
  });

  it('rejects an empty obligation list', () => {
    const result = validateObligations([]);
    assert.equal(result.valid, false);
    assert.equal(result.errors[0]?.code, 'no-obligations');
  });

  it('rejects when build-must-pass is missing', () => {
    const result = validateObligations([
      { type: 'file-must-exist', path: 'a.ts' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'missing-build-must-pass'));
  });

  it('accepts a contract without build-must-pass when requireBuild is false', () => {
    const result = validateObligations(
      [
        { type: 'file-must-exist', path: 'a.ts' },
        { type: 'test-must-pass', command: 'npm test' },
      ],
      { requireBuild: false },
    );
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('rejects when test-must-pass is missing', () => {
    const result = validateObligations([
      { type: 'file-must-exist', path: 'a.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'missing-test-must-pass'));
  });

  it('rejects unknown obligation type', () => {
    const result = validateObligations([
      { type: 'something-else', command: 'foo' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'schema'));
  });

  it('rejects absolute paths', () => {
    const result = validateObligations([
      { type: 'file-must-exist', path: '/etc/passwd' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'absolute-path'));
  });

  it('rejects empty path', () => {
    const result = validateObligations([
      { type: 'file-must-exist', path: '' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, false);
    // schema's minLength: 1 catches this; either 'schema' or 'empty-path' is acceptable
    assert.ok(
      result.errors.some((e) => e.code === 'empty-path' || e.code === 'schema'),
    );
  });

  it('rejects empty command', () => {
    const result = validateObligations([
      { type: 'build-must-pass', command: '' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.code === 'empty-command' || e.code === 'schema'),
    );
  });

  it('rejects duplicate file-must-exist paths', () => {
    const result = validateObligations([
      { type: 'file-must-exist', path: 'a.ts' },
      { type: 'file-must-exist', path: 'a.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'duplicate-file-must-exist'));
  });

  it('rejects duplicate build-must-pass commands', () => {
    const result = validateObligations([
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'duplicate-build-must-pass'));
  });

  it('rejects duplicate test-must-pass commands', () => {
    const result = validateObligations([
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
      { type: 'test-must-pass', command: 'npm test' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'duplicate-test-must-pass'));
  });

  it('rejects non-string types via schema', () => {
    const result = validateObligations([{ type: 42, path: 'a.ts' }]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'schema'));
  });
});
