import { strict as assert } from 'assert';
import { parseCodexCandidates } from '../../../../src/falsification/adapters/codex/codex-output-parser';
import { CODEX_CANDIDATE_COUNT } from '../../../../src/falsification/adapters/codex/codex-prompt';

/**
 * Unit tests for the Codex output parser. The parser is the seam between
 * "what Codex prints" and "what the adapter trusts". It is testable
 * directly with strings, so per the project's "no mocks for things
 * testable directly" rule these are real assertions over real input.
 */

function fenceJson(body: string): string {
  return ['some narration that should be ignored', '', '```json', body, '```'].join('\n');
}

function validCandidate(name: string): unknown {
  return {
    name,
    rationale: `forces predicate failure via ${name}`,
    files: [{ relPath: `${name}/leak.txt`, bytes: 'forbidden-token' }],
  };
}

function validCandidatesObject(): { candidates: unknown[] } {
  return {
    candidates: Array.from({ length: CODEX_CANDIDATE_COUNT }, (_, i) =>
      validCandidate(`candidate-${i}`),
    ),
  };
}

describe('parseCodexCandidates', () => {
  it('parses a well-formed fenced JSON document', () => {
    const json = JSON.stringify(validCandidatesObject());
    const parsed = parseCodexCandidates(fenceJson(json));
    assert.equal(parsed.length, CODEX_CANDIDATE_COUNT);
    assert.equal(parsed[0]?.name, 'candidate-0');
    assert.equal(parsed[0]?.files[0]?.relPath, 'candidate-0/leak.txt');
  });

  it('throws when the fenced block is missing', () => {
    assert.throws(() => parseCodexCandidates('no fence here at all'), /fenced ```json``` block/);
  });

  it('throws on JSON parse failure', () => {
    assert.throws(
      () => parseCodexCandidates(fenceJson('{ this is not json')),
      /did not parse as JSON/,
    );
  });

  it('throws when the candidate count is wrong', () => {
    const tooFew = { candidates: [validCandidate('only-one')] };
    assert.throws(
      () => parseCodexCandidates(fenceJson(JSON.stringify(tooFew))),
      /Codex returned 1 candidates/,
    );
  });

  it('throws when a candidate uses an absolute path', () => {
    const bad = validCandidatesObject();
    (bad.candidates[0] as { files: { relPath: string; bytes: string }[] }).files[0]!.relPath =
      '/etc/passwd';
    assert.throws(
      () => parseCodexCandidates(fenceJson(JSON.stringify(bad))),
      /must be relative/,
    );
  });

  it('throws when a candidate uses ".." escape', () => {
    const bad = validCandidatesObject();
    (bad.candidates[0] as { files: { relPath: string; bytes: string }[] }).files[0]!.relPath =
      '../escape.txt';
    assert.throws(
      () => parseCodexCandidates(fenceJson(JSON.stringify(bad))),
      /may not contain "\.\."/,
    );
  });

  it('throws on a candidate with empty files array', () => {
    const bad = validCandidatesObject();
    (bad.candidates[0] as { files: unknown[] }).files = [];
    assert.throws(
      () => parseCodexCandidates(fenceJson(JSON.stringify(bad))),
      /non-empty files array/,
    );
  });

  it('accepts a candidate file with empty bytes (legitimate empty-file payload)', () => {
    const ok = validCandidatesObject();
    (ok.candidates[0] as { files: { relPath: string; bytes: string }[] }).files = [
      { relPath: '.env', bytes: '' },
    ];
    const parsed = parseCodexCandidates(fenceJson(JSON.stringify(ok)));
    assert.equal(parsed[0]?.files[0]?.relPath, '.env');
    assert.equal(parsed[0]?.files[0]?.bytes, '');
  });
});
