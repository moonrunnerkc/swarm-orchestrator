import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  parsePullRequestDiff,
  resolveDiffPosition,
} from '../src/github/diff-position-resolver';
import { createFinding, type LineFinding } from '../src/types/finding';

function fixture(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'test', 'fixtures', 'sample-diffs', name),
    'utf8',
  );
}

function finding(line: number): LineFinding {
  const result = createFinding({
    scope: 'line',
    producerId: 'cheat-detector',
    ruleId: 'fixture-rule',
    severity: 'medium',
    filePath: 'src/example.ts',
    line,
    message: 'Fixture finding for diff position resolution.',
  });
  assert.strictEqual(result.scope, 'line');
  return result;
}

describe('diff position resolver', () => {
  it('returns the direct diff line and side for a finding on an added hunk line', () => {
    const diff = parsePullRequestDiff(fixture('in-hunk.diff'));
    const resolution = resolveDiffPosition(finding(2), diff);

    assert.deepStrictEqual(resolution, {
      line: 2,
      side: 'RIGHT',
      originalLine: 2,
      relocated: false,
    });
  });

  it('relocates a finding to the nearest hunk line within five lines', () => {
    const diff = parsePullRequestDiff(fixture('near-hunk.diff'));
    const resolution = resolveDiffPosition(finding(14), diff);

    assert.deepStrictEqual(resolution, {
      line: 10,
      side: 'RIGHT',
      originalLine: 14,
      relocated: true,
    });
  });

  it('returns null when no hunk line is within five lines', () => {
    const diff = parsePullRequestDiff(fixture('far-from-hunk.diff'));
    const resolution = resolveDiffPosition(finding(40), diff);

    assert.strictEqual(resolution, null);
  });
});
