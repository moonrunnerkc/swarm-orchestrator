import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkPredicateBaseline,
  runPredicate,
} from '../../src/verification/predicate-runner';

// Unit tests for the generic predicate runner at
// src/verification/predicate-runner.ts. Adapters now consume this
// module directly via the shared shell-candidate-runner.

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-verification-predicate-runner-'));
}

describe('runPredicate', () => {
  it('returns exitCode 0 and captures stdout when the predicate succeeds', () => {
    const ws = makeWorkspace();
    try {
      const result = runPredicate('echo hello', ws);
      assert.equal(result.exitCode, 0);
      assert.match(result.output, /hello/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('returns non-zero exitCode and captures stderr when the predicate fails', () => {
    const ws = makeWorkspace();
    try {
      const result = runPredicate('false', ws);
      assert.notEqual(result.exitCode, 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('runs in the supplied workspaceRoot', () => {
    const ws = makeWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'marker.txt'), 'sentinel');
      const result = runPredicate('test -f marker.txt', ws);
      assert.equal(result.exitCode, 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('checkPredicateBaseline', () => {
  it('reports ok=true when the predicate already holds against the baseline', () => {
    const ws = makeWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'config.txt'), 'feature-flag-enabled');
      const result = checkPredicateBaseline("grep -q 'feature-flag-enabled' config.txt", ws);
      assert.equal(result.ok, true);
      assert.equal(result.exitCode, 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('reports ok=false when the predicate fails on the baseline', () => {
    const ws = makeWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'config.txt'), 'no-flag');
      const result = checkPredicateBaseline("grep -q 'feature-flag-enabled' config.txt", ws);
      assert.equal(result.ok, false);
      assert.notEqual(result.exitCode, 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

