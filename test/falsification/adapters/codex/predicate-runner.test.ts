import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runShellCandidate } from '../../../../src/falsification/adapters/candidate-runners';
import { checkPredicateBaseline } from '../../../../src/verification/predicate-runner';
import type { ParsedCandidate } from '../../../../src/falsification/adapters/cli-falsifier';

function runCandidateAgainstPredicate(c: ParsedCandidate, p: string, w: string) {
  return runShellCandidate(c, p, w, 'Codex');
}

/**
 * Unit tests for the predicate runner. These exercise the real
 * filesystem and the real shell predicate execution path; the only
 * fixture is a fresh temp workspace per test so each candidate runs in
 * isolation.
 */

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-predicate-runner-'));
}

function candidate(relPath: string, bytes: string): ParsedCandidate {
  return {
    name: 'unit-candidate',
    rationale: 'unit test',
    files: [{ relPath, bytes }],
  };
}

describe('runCandidateAgainstPredicate', () => {
  it('reports falsified when the candidate makes the predicate fail', () => {
    const ws = makeWorkspace();
    try {
      // predicate: assert no file under leak/ contains "FORBIDDEN".
      // candidate writes such a file → predicate exits non-zero → falsified.
      const predicate = '! grep -r "FORBIDDEN" leak 2>/dev/null';
      const result = runCandidateAgainstPredicate(
        candidate('leak/contraband.txt', 'this contains FORBIDDEN'),
        predicate,
        ws,
      );
      assert.equal(result.falsified, true);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.counterExample);
      assert.equal(result.counterExample!.files[0]!.relPath, 'leak/contraband.txt');
      assert.equal(result.counterExample!.reproducer, predicate);
      // file should be cleaned up after running
      assert.equal(fs.existsSync(path.join(ws, 'leak/contraband.txt')), false);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('reports false positive when the candidate does not falsify', () => {
    const ws = makeWorkspace();
    try {
      // predicate stays satisfied — file content lacks the forbidden token.
      const predicate = '! grep -r "FORBIDDEN" allowed 2>/dev/null';
      const result = runCandidateAgainstPredicate(
        candidate('allowed/safe.txt', 'no token here'),
        predicate,
        ws,
      );
      assert.equal(result.falsified, false);
      assert.equal(result.exitCode, 0);
      assert.equal(result.counterExample, null);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('rejects a candidate that names an existing path', () => {
    const ws = makeWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'pre-existing.txt'), 'do not overwrite me', 'utf8');
      assert.throws(
        () =>
          runCandidateAgainstPredicate(
            candidate('pre-existing.txt', 'overwriting attempt'),
            'true',
            ws,
          ),
        /already exists/,
      );
      assert.equal(
        fs.readFileSync(path.join(ws, 'pre-existing.txt'), 'utf8'),
        'do not overwrite me',
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('rejects paths that resolve outside the workspace root', () => {
    const ws = makeWorkspace();
    try {
      // The output parser blocks "..", but the runner has its own boundary
      // check as defense-in-depth; this asserts the boundary check fires
      // when fed a path that resolves outside ws.
      const escape: ParsedCandidate = {
        name: 'escape',
        rationale: 'attempts to write outside workspace',
        files: [{ relPath: '/tmp/swarm-escape-target', bytes: 'no' }],
      };
      assert.throws(
        () => runCandidateAgainstPredicate(escape, 'true', ws),
        /outside the workspace root|already exists/,
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('preserves the baseline contract: predicate must pass against an unmodified workspace', () => {
    const ws = makeWorkspace();
    try {
      // Empty workspace + "no FORBIDDEN here" predicate → exit 0 → baseline ok.
      const okBaseline = checkPredicateBaseline('! grep -r "FORBIDDEN" . 2>/dev/null', ws);
      assert.equal(okBaseline.ok, true);
      assert.equal(okBaseline.exitCode, 0);

      // Plant the forbidden token; baseline must now report not-ok so callers
      // can short-circuit before invoking the codex CLI.
      fs.writeFileSync(path.join(ws, 'tainted.txt'), 'FORBIDDEN', 'utf8');
      const taintedBaseline = checkPredicateBaseline('! grep -r "FORBIDDEN" . 2>/dev/null', ws);
      assert.equal(taintedBaseline.ok, false);
      assert.notEqual(taintedBaseline.exitCode, 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('removes empty directories the candidate created', () => {
    const ws = makeWorkspace();
    try {
      const result = runCandidateAgainstPredicate(
        candidate('nested/dir/payload.txt', 'content'),
        'true',
        ws,
      );
      assert.equal(result.falsified, false);
      assert.equal(fs.existsSync(path.join(ws, 'nested/dir/payload.txt')), false);
      assert.equal(fs.existsSync(path.join(ws, 'nested/dir')), false);
      assert.equal(fs.existsSync(path.join(ws, 'nested')), false);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
