import { execSync } from 'child_process';
import { GateContext, GateIssue, GateResult, TestFileProtectionConfig } from '../types';

/**
 * D4: Test-File Protection Gate
 *
 * Detects when an agent has **modified** (not added) pre-existing test files.
 * Agents should write new tests, not weaken existing ones.
 *
 * Uses `git diff --name-only --diff-filter=M` against a base commit
 * and matches the results against configurable test-file patterns.
 */
export async function run_test_file_protection_gate(
  projectRoot: string,
  config: TestFileProtectionConfig,
  baseCommit?: string
): Promise<GateResult> {
  const start = Date.now();
  const issues: GateIssue[] = [];

  const base = baseCommit || 'HEAD~1';
  const patterns = config.testFileGlobs;

  try {
    // Get all MODIFIED (not Added) files relative to the base commit
    const raw = execSync(
      `git diff --name-only --diff-filter=M ${base}`,
      { cwd: projectRoot, encoding: 'utf8', timeout: 30_000 }
    ).trim();

    if (raw.length === 0) {
      return result('pass', issues, Date.now() - start, 0);
    }

    const modifiedFiles = raw.split('\n').filter(Boolean);

    // Compile glob-like patterns to regexes
    const matchers = patterns.map(glob_to_regex);

    let flagged = 0;
    for (const file of modifiedFiles) {
      if (matchers.some(re => re.test(file))) {
        flagged++;
        issues.push({
          message: `Pre-existing test file was modified by an agent`,
          filePath: file,
          hint: 'Agents should add new test files, not modify existing ones. ' +
                'If the modification is fixing an import path or test config, ' +
                'consider an allowlist entry in quality-gates.yaml.'
        });
        if (issues.length >= (config.maxFindings ?? 25)) break;
      }
    }

    const status = issues.length > 0 ? 'fail' : 'pass';
    return result(status, issues, Date.now() - start, flagged);
  } catch (err: unknown) {
    // git not available or not a repo — skip gracefully
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: 'test-file-protection',
      title: 'Test files not modified by agents',
      status: 'skip',
      durationMs: Date.now() - start,
      issues: [{
        message: `Could not run git diff: ${msg.slice(0, 200)}`,
        hint: 'Ensure the project is a git repo with at least one commit.'
      }],
      stats: { flagged: 0 }
    };
  }
}

function result(
  status: GateResult['status'],
  issues: GateIssue[],
  durationMs: number,
  flagged: number
): GateResult {
  return {
    id: 'test-file-protection',
    title: 'Test files not modified by agents',
    status,
    durationMs,
    issues,
    stats: { flagged }
  };
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: ** (any path), * (any segment chars), ? (single char).
 * Patterns are matched against the full relative path.
 */
function glob_to_regex(glob: string): RegExp {
  let re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex specials (except * and ?)
    .replace(/\*\*/g, '$$GLOBSTAR$$')        // placeholder for **
    .replace(/\*/g, '[^/]*')                 // * = anything except /
    .replace(/\?/g, '.')                     // ? = single char
    .replace(/\$\$GLOBSTAR\$\$/g, '.*');     // ** = anything including /
  return new RegExp(`^${re}$`, 'i');
}
