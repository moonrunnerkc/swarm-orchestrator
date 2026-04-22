// Author: Bradley R. Kinnard
import { strict as assert } from 'assert';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORCHESTRATOR_RESERVED_PATHS,
  BUILD_ARTIFACT_RESERVED_PATHS,
  FILE_GLOB_EXCLUDES,
  gitPathspecExcludes,
} from '../src/worktree-reserved-paths';

// __dirname is dist/test/ at runtime; step up two levels to reach repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PYTHON_FILE = path.join(
  REPO_ROOT,
  'benchmarks/swe-bench/evaluation-scripts/worktree_reserved_paths.py'
);

/**
 * Extract the string contents of a Python tuple/list literal from source text.
 * Handles multi-line tuples with inline comments by doing a line-by-line walk:
 * 1. Find the line where NAME appears as an assignment (not in a docstring comment).
 * 2. From there, accumulate lines until we see a line that closes the tuple/list.
 * 3. Strip comments from each line, then collect quoted strings.
 */
function extractPythonTuple(src: string, name: string): string[] {
  const lines = src.split('\n');

  // Find the assignment line: must start with the name (ignoring leading spaces)
  // and contain '=' and '(' or '['. Skip comment-only lines.
  let startIdx = -1;
  const assignRe = new RegExp(`^\\s*${name}\\s*[^=]*=\\s*[\\(\\[]`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) continue;
    if (assignRe.test(line)) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    throw new Error(`Could not find assignment for ${name} in Python source`);
  }

  // Walk forward accumulating lines until we see a closing ) or ] on its own line
  const bodyLines: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];
    // Strip inline comment
    const noComment = raw.replace(/#.*$/, '');
    bodyLines.push(noComment);
    // Check if this line closes the tuple: trimmed is just ')' or ']'
    if (i > startIdx && /^\s*[\)\]]/.test(noComment)) {
      break;
    }
  }

  const body = bodyLines.join('\n');
  const items: string[] = [];
  const itemRe = /["']([^"'\n]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(body)) !== null) {
    items.push(m[1]);
  }
  return items;
}

describe('worktree-reserved-paths: cross-language parity', () => {
  let pythonSrc: string;

  before(() => {
    assert.ok(
      fs.existsSync(PYTHON_FILE),
      `Python canonical file not found: ${PYTHON_FILE}`
    );
    pythonSrc = fs.readFileSync(PYTHON_FILE, 'utf8');
  });

  it('ORCHESTRATOR_RESERVED_PATHS matches Python ORCHESTRATOR_RESERVED_PATHS', () => {
    const pyValues = extractPythonTuple(pythonSrc, 'ORCHESTRATOR_RESERVED_PATHS');
    assert.deepStrictEqual(
      Array.from(ORCHESTRATOR_RESERVED_PATHS),
      pyValues,
      `TS ORCHESTRATOR_RESERVED_PATHS does not match Python.\n` +
      `  TS:  ${JSON.stringify(ORCHESTRATOR_RESERVED_PATHS)}\n` +
      `  Py:  ${JSON.stringify(pyValues)}`
    );
  });

  it('BUILD_ARTIFACT_RESERVED_PATHS matches Python BUILD_ARTIFACT_RESERVED_PATHS', () => {
    const pyValues = extractPythonTuple(pythonSrc, 'BUILD_ARTIFACT_RESERVED_PATHS');
    assert.deepStrictEqual(
      Array.from(BUILD_ARTIFACT_RESERVED_PATHS),
      pyValues,
      `TS BUILD_ARTIFACT_RESERVED_PATHS does not match Python.\n` +
      `  TS:  ${JSON.stringify(BUILD_ARTIFACT_RESERVED_PATHS)}\n` +
      `  Py:  ${JSON.stringify(pyValues)}`
    );
  });

  it('FILE_GLOB_EXCLUDES matches Python _FILE_GLOB_EXCLUDES', () => {
    const pyValues = extractPythonTuple(pythonSrc, '_FILE_GLOB_EXCLUDES');
    assert.deepStrictEqual(
      Array.from(FILE_GLOB_EXCLUDES),
      pyValues,
      `TS FILE_GLOB_EXCLUDES does not match Python _FILE_GLOB_EXCLUDES.\n` +
      `  TS:  ${JSON.stringify(FILE_GLOB_EXCLUDES)}\n` +
      `  Py:  ${JSON.stringify(pyValues)}`
    );
  });

  it('gitPathspecExcludes() output matches Python git_pathspec_excludes() output', () => {
    // Run the Python function via subprocess and compare arrays element-by-element
    const result = spawnSync(
      'python3',
      ['-c', `
import sys, json
sys.path.insert(0, '${path.join(REPO_ROOT, 'benchmarks/swe-bench/evaluation-scripts').replace(/\\/g, '\\\\')}')
from worktree_reserved_paths import git_pathspec_excludes
print(json.dumps(git_pathspec_excludes()))
`],
      { encoding: 'utf8' }
    );

    assert.strictEqual(
      result.status,
      0,
      `Python subprocess failed:\n${result.stderr}`
    );

    const pyOutput: string[] = JSON.parse(result.stdout.trim());
    const tsOutput = gitPathspecExcludes();

    assert.deepStrictEqual(
      tsOutput,
      pyOutput,
      `gitPathspecExcludes() output diverges from Python git_pathspec_excludes().\n` +
      `  TS length: ${tsOutput.length}, Py length: ${pyOutput.length}\n` +
      `  First mismatch at index: ${tsOutput.findIndex((v, i) => v !== pyOutput[i])}`
    );
  });
});

describe('worktree-reserved-paths: bounded-list invariants', () => {
  it('ORCHESTRATOR_RESERVED_PATHS has at most 5 entries', () => {
    assert.ok(
      ORCHESTRATOR_RESERVED_PATHS.length <= 5,
      `ORCHESTRATOR_RESERVED_PATHS has ${ORCHESTRATOR_RESERVED_PATHS.length} entries (limit: 5). ` +
      `If this is a legitimate addition, update the bound in this test.`
    );
  });

  it('BUILD_ARTIFACT_RESERVED_PATHS has at most 15 entries', () => {
    assert.ok(
      BUILD_ARTIFACT_RESERVED_PATHS.length <= 15,
      `BUILD_ARTIFACT_RESERVED_PATHS has ${BUILD_ARTIFACT_RESERVED_PATHS.length} entries (limit: 15). ` +
      `If this is a legitimate addition, update the bound in this test.`
    );
  });

  it('FILE_GLOB_EXCLUDES has at most 6 entries', () => {
    assert.ok(
      FILE_GLOB_EXCLUDES.length <= 6,
      `FILE_GLOB_EXCLUDES has ${FILE_GLOB_EXCLUDES.length} entries (limit: 6). ` +
      `If this is a legitimate addition, update the bound in this test.`
    );
  });

  it('gitPathspecExcludes() emits the expected number of args (14 dirs × 2 + 5 globs = 33)', () => {
    const excludes = gitPathspecExcludes();
    const expectedDirCount = ORCHESTRATOR_RESERVED_PATHS.length + BUILD_ARTIFACT_RESERVED_PATHS.length;
    const expected = expectedDirCount * 2 + FILE_GLOB_EXCLUDES.length;
    assert.strictEqual(
      excludes.length,
      expected,
      `Expected ${expected} pathspec args, got ${excludes.length}`
    );
  });

  it('every gitPathspecExcludes() entry starts with :(exclude)', () => {
    const bad = gitPathspecExcludes().filter(e => !e.startsWith(':(exclude)'));
    assert.strictEqual(
      bad.length,
      0,
      `Entries missing :(exclude) prefix: ${JSON.stringify(bad)}`
    );
  });
});
