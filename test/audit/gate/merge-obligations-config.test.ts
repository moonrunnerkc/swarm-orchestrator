import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadMergeObligations } from '../../../src/audit/gate/merge-obligations-config';

function withRepo(yamlBody: string | null, body: (repoRoot: string) => void): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-obligations-'));
  try {
    if (yamlBody !== null) {
      fs.mkdirSync(path.join(repoRoot, '.swarm'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, '.swarm', 'merge-obligations.yaml'), yamlBody);
    }
    body(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

describe('audit/gate/merge-obligations-config loadMergeObligations', () => {
  it('returns no obligations and no error when the file is absent', () => {
    withRepo(null, (repoRoot) => {
      const result = loadMergeObligations(repoRoot);
      assert.equal(result.present, false);
      assert.equal(result.obligations.length, 0);
      assert.equal(result.errors.length, 0);
    });
  });

  it('parses a valid obligations list', () => {
    const body = [
      'obligations:',
      '  - type: coverage-must-exceed',
      '    scope: src/',
      '    metric: lines',
      '    threshold: 80',
      '  - type: property-must-hold',
      '    predicate: "test -f dist/index.js"',
      '    target: dist/index.js',
      '',
    ].join('\n');
    withRepo(body, (repoRoot) => {
      const result = loadMergeObligations(repoRoot);
      assert.equal(result.present, true);
      assert.equal(result.errors.length, 0);
      assert.equal(result.obligations.length, 2);
      assert.equal(result.obligations[0]?.type, 'coverage-must-exceed');
      assert.equal(result.obligations[1]?.type, 'property-must-hold');
    });
  });

  it('accepts a bare top-level YAML list', () => {
    const body = ['- type: test-must-pass', '  command: npm test', ''].join('\n');
    withRepo(body, (repoRoot) => {
      const result = loadMergeObligations(repoRoot);
      assert.equal(result.errors.length, 0);
      assert.equal(result.obligations.length, 1);
      assert.equal(result.obligations[0]?.type, 'test-must-pass');
    });
  });

  it('flags an obligation that fails the schema and excludes it', () => {
    const body = [
      'obligations:',
      '  - type: coverage-must-exceed', // missing scope/metric/threshold
      '  - type: file-must-exist',
      '    path: README.md',
      '',
    ].join('\n');
    withRepo(body, (repoRoot) => {
      const result = loadMergeObligations(repoRoot);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0] ?? '', /obligation 0 .* failed schema/);
      // The well-formed obligation still parses.
      assert.equal(result.obligations.length, 1);
      assert.equal(result.obligations[0]?.type, 'file-must-exist');
    });
  });

  it('errors when the document is not an obligations list', () => {
    withRepo('obligations: not-a-list\n', (repoRoot) => {
      const result = loadMergeObligations(repoRoot);
      assert.equal(result.present, true);
      assert.equal(result.obligations.length, 0);
      assert.match(result.errors[0] ?? '', /must contain an "obligations:" list/);
    });
  });

  it('errors on unparseable YAML', () => {
    withRepo('obligations: [unbalanced\n', (repoRoot) => {
      const result = loadMergeObligations(repoRoot);
      assert.equal(result.present, true);
      assert.match(result.errors[0] ?? '', /not valid YAML/);
    });
  });

  it('treats an empty file as no extra obligations', () => {
    withRepo('', (repoRoot) => {
      const result = loadMergeObligations(repoRoot);
      assert.equal(result.present, true);
      assert.equal(result.obligations.length, 0);
      assert.equal(result.errors.length, 0);
    });
  });
});
