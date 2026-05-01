import { strict as assert } from 'assert';
import {
  appendFindingMarker,
  computeFindingId,
  parseFindingId,
  reconcileFindings,
  type ExistingComment,
} from '../src/github/comment-dedup';
import { createFinding, type Finding, type FindingInput } from '../src/types/finding';

type LineFindingInput = Extract<FindingInput, { scope: 'line' }>;

function finding(input: FindingInput): Finding {
  return createFinding(input);
}

describe('comment dedup', () => {
  it('computes stable ids from file, line, rule, and message only', () => {
    const baseInput: LineFindingInput = {
      scope: 'line',
      producerId: 'cheat-detector',
      ruleId: 'hardcoded-answer',
      severity: 'high',
      filePath: 'src/example.ts',
      line: 10,
      message: 'Implementation copied an expected literal.',
    };
    const base = finding(baseInput);

    const same = finding(baseInput);
    const differentFile = finding({ ...baseInput, filePath: 'src/other.ts' });
    const differentLine = finding({ ...baseInput, line: 11 });
    const differentRule = finding({ ...baseInput, ruleId: 'different-rule' });
    const differentMessage = finding({ ...baseInput, message: 'A different finding message.' });
    const differentSeverity = finding({ ...baseInput, severity: 'medium' });
    const differentProducer = finding({ ...baseInput, producerId: 'property-gate' });

    const id = computeFindingId(base);
    assert.match(id, /^[a-f0-9]{16}$/);
    assert.equal(id, computeFindingId(base));
    assert.equal(id, computeFindingId(same));
    assert.notEqual(id, computeFindingId(differentFile));
    assert.notEqual(id, computeFindingId(differentLine));
    assert.notEqual(id, computeFindingId(differentRule));
    assert.notEqual(id, computeFindingId(differentMessage));
    assert.equal(id, computeFindingId(differentSeverity));
    assert.equal(id, computeFindingId(differentProducer));
  });

  it('parses only strict final-line finding markers', () => {
    const marker = '<!-- swarm-finding-id:0123456789abcdef -->';

    assert.equal(parseFindingId(`body\n${marker}`), '0123456789abcdef');
    assert.equal(parseFindingId('body without marker'), null);
    assert.equal(parseFindingId('body\n<!-- swarm-finding-id:0123456789abcde -->'), null);
    assert.equal(parseFindingId('body\n<!-- other-finding-id:0123456789abcdef -->'), null);
    assert.equal(parseFindingId(`body\n${marker}\nextra`), null);
  });

  it('appends a parseable marker as the final line', () => {
    const body = appendFindingMarker('body with trailing whitespace  \n', '0123456789abcdef');

    assert.equal(body, 'body with trailing whitespace\n\n<!-- swarm-finding-id:0123456789abcdef -->');
    assert.equal(parseFindingId(body), '0123456789abcdef');
  });

  it('partitions current findings against existing marked comments', () => {
    const unchangedFinding = finding({
      scope: 'line',
      producerId: 'cheat-detector',
      ruleId: 'hardcoded-answer',
      severity: 'high',
      filePath: 'src/example.ts',
      line: 10,
      message: 'Implementation copied an expected literal.',
    });
    const newFinding = finding({
      scope: 'line',
      producerId: 'property-gate',
      ruleId: 'property-counterexample',
      severity: 'medium',
      filePath: 'src/example.ts',
      line: 12,
      message: 'Property test found a counterexample.',
    });
    const staleFinding = finding({
      scope: 'line',
      producerId: 'mutation-gate',
      ruleId: 'mutation-score-fail',
      severity: 'high',
      filePath: 'src/example.ts',
      line: 14,
      message: 'Mutation score fell below threshold.',
    });
    const unchangedComment: ExistingComment = {
      id: 101,
      body: 'existing',
      findingId: computeFindingId(unchangedFinding),
    };
    const staleComment: ExistingComment = {
      id: 102,
      body: 'stale',
      findingId: computeFindingId(staleFinding),
    };
    const unrelatedComment: ExistingComment = {
      id: 103,
      body: 'human comment',
      findingId: null,
    };

    const result = reconcileFindings({
      existingComments: [unchangedComment, staleComment, unrelatedComment],
      currentFindings: [unchangedFinding, newFinding],
    });

    assert.deepEqual(result.toPost, [newFinding]);
    assert.deepEqual(result.toResolve, [staleComment]);
    assert.deepEqual(result.unchanged, [unchangedComment]);
  });
});
