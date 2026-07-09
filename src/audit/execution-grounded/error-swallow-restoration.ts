// Error-swallow restoration proof. The error-swallow structural detector raises a
// `bare` finding when a PR adds an empty catch (JS/TS) or `except: pass` (Python).
// That is a candidate, not a verdict: an empty catch can conceal a live failure
// (a cheat) or absorb an expected error (a legitimate defensive path). This engine
// settles which, by execution: it NEUTRALIZES the swallow in the sandbox (rewrites
// the catch to re-throw) and reruns the affected test.
//
//   - the test fails twice with the same identity when the swallow is neutralized,
//     and passed as submitted with the swallow present: PROVEN. The swallow was
//     load-bearing; it masked a test-visible failure.
//   - the test still passes with the swallow neutralized: REFUTED. Nothing was
//     masked; the catch is defensive (its error path is not hit, or not asserted).
//
// The proof is sound about what it proves (a load-bearing swallow), which is why
// its finding ships ADVISORY: a load-bearing swallow can be a concealed regression
// OR a legitimate graceful-degradation a test happens to rely on. The engine never
// decides that question; it surfaces the fact for a human. Fail-closed throughout:
// it never throws, and every non-proven verdict carries a loud reason. No model
// calls. The neutralization is reverted before returning so the workspace is clean
// for later consumers.

import { spawnSync } from 'child_process';
import { getLogger } from '../../logger';
import type { CheatCategory } from '../types';
import type { TestRunner, PackageManager } from './sandbox';
import type { MutationRecipe } from './mutation-check';
import type { DockerContext } from './docker-runner';
import { executeTestRun, type TestRunResult } from './test-restoration';

const log = getLogger('audit:execution-grounded:error-swallow-restoration');

export type ErrorSwallowVerdict =
  | 'proven'
  | 'refuted'
  | 'not-proven:suite-already-failing'
  | 'not-proven:flaky'
  | 'not-proven:no-swallow-located'
  | 'not-proven:neutralization-noop'
  | 'not-proven:runner-unsupported'
  | 'not-proven:no-workspace'
  | 'not-proven:execution-error';

export interface ErrorSwallowControls {
  /** Control 1: the affected test passes as submitted (with the swallow). */
  suitePassesAsSubmitted: boolean | null;
  /** Control 2: with the swallow neutralized, the test fails twice, same identity. */
  neutralizedFailsTwiceSameIdentity: boolean | null;
  /** Control 3: neutralization actually changed the source (a swallow was found
   *  and rewritten). A no-op rewrite proves nothing. */
  neutralizationApplied: boolean | null;
}

export interface ErrorSwallowProofRecord {
  schemaVersion: 1;
  verdict: ErrorSwallowVerdict;
  category: CheatCategory;
  findingFile: string;
  /** The affected test file(s) run to observe the masked failure. */
  testFiles: string[];
  failingTests: string[];
  controls: ErrorSwallowControls;
  /** The neutralization applied, for the human-facing record ('catch->rethrow'). */
  neutralization: string;
  reason?: string;
}

export interface ErrorSwallowRestorationInput {
  finding: { category: CheatCategory; file: string };
  /** The affected test file(s) whose run observes the masked failure. */
  testFiles: string[];
  prRef: string;
  preWorkspacePath: string | null;
  postWorkspacePath: string;
  testRunner: TestRunner | null;
  packageManager: PackageManager;
  recipe?: MutationRecipe;
  timeoutMs: number;
  docker?: DockerContext;
}

/** The error-swallow shapes this engine can neutralize by rewriting to re-throw.
 *  Each `find` is NON-global (replaces the first occurrence only, so exactly one
 *  swallow is neutralized), and `apply` builds the replacement from the capture
 *  groups. Kept narrow and language-anchored so a rewrite is unambiguous; anything
 *  not matched leaves the source untouched and the engine reports
 *  not-proven:no-swallow-located (fail closed). */
const SWALLOW_REWRITES: ReadonlyArray<{
  id: string;
  find: RegExp;
  apply: (groups: string[]) => string;
}> = [
  // JS/TS: `catch (e) {}` / `catch(err){ }` -> rethrow the caught binding.
  {
    id: 'catch-binding',
    find: /catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*\}/,
    apply: (g) => `catch (${g[0]}) { throw ${g[0]}; }`,
  },
  // JS/TS: `catch {}` (no binding) -> introduce a binding and rethrow.
  {
    id: 'catch-bindingless',
    find: /catch\s*\{\s*\}/,
    apply: () => 'catch (swallowedErr) { throw swallowedErr; }',
  },
  // Python: `except [<Type>[ as e]]: pass` -> `raise`, preserving the block's
  // indentation ($2) so the rewritten `raise` sits one level (4 spaces) deeper.
  // Handles both the single-line (`except X: pass`) and the conventional
  // two-line (`except X:\n    pass`) forms.
  {
    id: 'except-pass',
    find: /(^|\n)([ \t]*)except([^\n:]*):[ \t]*\n?[ \t]*pass\b/,
    apply: (g) => `${g[0]}${g[1]}except${g[2]}:\n${g[1]}    raise`,
  },
];

/**
 * Pure: rewrite the first error-swallow in `source` to re-throw, returning the
 * new source and which rewrite fired, or null when no known swallow shape is
 * present. Conservative: only the anchored empty-catch / `except: pass` forms
 * match, so a catch with any real body (a logger, a fallback) is never touched.
 * Rewrites exactly one swallow (the finding's) so an unrelated defensive catch
 * elsewhere in the file is left intact.
 *
 * @param source the file's full text.
 * @returns { source, id } with the neutralized text and the rewrite id, or null.
 */
export function neutralizeErrorSwallow(source: string): { source: string; id: string } | null {
  for (const rule of SWALLOW_REWRITES) {
    if (!rule.find.test(source)) continue;
    // Function replacer so the computed text is inserted literally (no `$`
    // substitution). Replacer args are (match, ...groups, offset, wholeString);
    // drop the match and the trailing offset+string to get the capture groups.
    const next = source.replace(rule.find, (...m: unknown[]) =>
      rule.apply(m.slice(1, -2) as string[]),
    );
    if (next !== source) return { source: next, id: rule.id };
  }
  return null;
}

function identitySet(tests: string[]): string[] {
  return [...new Set(tests)].sort();
}

/** Pure: classify from executed control results. Mirrors test-restoration's
 *  fail-closed classifier: the swallow must be load-bearing (pass with it, fail
 *  twice with the same identity without it) to prove. */
export function classifyErrorSwallow(c: {
  suitePassesAsSubmitted: boolean;
  neutralizedRun1Failed: boolean;
  neutralizedRun2Failed: boolean;
  run1FailingTests: string[];
  run2FailingTests: string[];
}): { verdict: ErrorSwallowVerdict; failingTests: string[] } {
  if (!c.suitePassesAsSubmitted) {
    return { verdict: 'not-proven:suite-already-failing', failingTests: [] };
  }
  if (!c.neutralizedRun1Failed && !c.neutralizedRun2Failed) {
    return { verdict: 'refuted', failingTests: [] };
  }
  if (c.neutralizedRun1Failed !== c.neutralizedRun2Failed) {
    return { verdict: 'not-proven:flaky', failingTests: [] };
  }
  const run1 = identitySet(c.run1FailingTests);
  const run2 = identitySet(c.run2FailingTests);
  const sameIdentity = run1.length === run2.length && run1.every((t, i) => t === run2[i]);
  if (!sameIdentity) return { verdict: 'not-proven:flaky', failingTests: [] };
  if (run1.length === 0) return { verdict: 'not-proven:execution-error', failingTests: [] };
  return { verdict: 'proven', failingTests: run1 };
}

/** Read a file, or null when it cannot be read (a workspace drift). */
function readFile(path: string): string | null {
  const res = spawnSync('cat', [path], { encoding: 'utf8' });
  return res.status === 0 && typeof res.stdout === 'string' ? res.stdout : null;
}

function writeFile(path: string, content: string): boolean {
  const res = spawnSync('bash', ['-c', 'cat > "$0"', path], { input: content, encoding: 'utf8' });
  return res.status === 0;
}

/**
 * Impure orchestrator: prove (or fail to prove) that a PR-added error swallow is
 * load-bearing. Never throws; every non-proven verdict carries a reason. The
 * neutralized source file is restored before returning so the shared workspace is
 * clean for later consumers, even on error.
 *
 * @param input the finding, affected test files, workspaces, and runner.
 * @returns the proof record.
 */
export function runErrorSwallowRestoration(
  input: ErrorSwallowRestorationInput,
): ErrorSwallowProofRecord {
  try {
    return runPipeline(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`error-swallow-restoration: orchestrator threw unexpectedly: ${message}`);
    return record(input, 'not-proven:execution-error', {
      reason: `error-swallow-restoration orchestrator threw unexpectedly: ${message}`,
    });
  }
}

function record(
  input: ErrorSwallowRestorationInput,
  verdict: ErrorSwallowVerdict,
  fields: {
    testFiles?: string[];
    failingTests?: string[];
    neutralization?: string;
    controls?: Partial<ErrorSwallowControls>;
    reason?: string;
  },
): ErrorSwallowProofRecord {
  return {
    schemaVersion: 1,
    verdict,
    category: input.finding.category,
    findingFile: input.finding.file,
    testFiles: fields.testFiles ?? [],
    failingTests: fields.failingTests ?? [],
    controls: {
      suitePassesAsSubmitted: fields.controls?.suitePassesAsSubmitted ?? null,
      neutralizedFailsTwiceSameIdentity: fields.controls?.neutralizedFailsTwiceSameIdentity ?? null,
      neutralizationApplied: fields.controls?.neutralizationApplied ?? null,
    },
    neutralization: fields.neutralization ?? '',
    ...(fields.reason !== undefined ? { reason: fields.reason } : {}),
  };
}

function runPipeline(input: ErrorSwallowRestorationInput): ErrorSwallowProofRecord {
  const runner = input.testRunner;
  if (runner === null) {
    return record(input, 'not-proven:runner-unsupported', {
      reason: 'no supported test runner detected in the workspace',
    });
  }
  if (input.testFiles.length === 0) {
    return record(input, 'not-proven:no-swallow-located', {
      reason: 'no affected test file supplied to observe the masked failure',
    });
  }
  const runOpts = {
    runner,
    files: input.testFiles,
    cwd: input.postWorkspacePath,
    timeoutMs: input.timeoutMs,
    ...(input.recipe !== undefined ? { recipe: input.recipe } : {}),
    ...(input.docker !== undefined ? { docker: input.docker } : {}),
  };

  // Control 1: the affected test passes as submitted (swallow present).
  const submitted = executeTestRun(runOpts);
  if (submitted.timedOut || submitted.spawnFailed) {
    return record(input, 'not-proven:execution-error', {
      testFiles: input.testFiles,
      reason: `submitted run did not complete (${submitted.timedOut ? 'timeout' : 'spawn failure'}): ${submitted.rawOutput.slice(0, 300)}`,
    });
  }
  if (!submitted.passed) {
    return record(input, 'not-proven:suite-already-failing', {
      testFiles: input.testFiles,
      controls: { suitePassesAsSubmitted: false },
      reason: `the affected test fails as submitted (${submitted.failingTests.join(', ')}); CI would have caught this PR`,
    });
  }

  // Neutralize the swallow in the finding file.
  const filePath = `${input.postWorkspacePath}/${input.finding.file}`;
  const original = readFile(filePath);
  if (original === null) {
    return record(input, 'not-proven:execution-error', {
      testFiles: input.testFiles,
      controls: { suitePassesAsSubmitted: true },
      reason: `could not read the finding file ${input.finding.file} in the post workspace`,
    });
  }
  const neutralized = neutralizeErrorSwallow(original);
  if (neutralized === null || neutralized.source === original) {
    return record(input, 'not-proven:no-swallow-located', {
      testFiles: input.testFiles,
      controls: { suitePassesAsSubmitted: true, neutralizationApplied: false },
      reason: `no known error-swallow shape (empty catch / except: pass) located in ${input.finding.file}`,
    });
  }
  if (!writeFile(filePath, neutralized.source)) {
    return record(input, 'not-proven:execution-error', {
      testFiles: input.testFiles,
      controls: { suitePassesAsSubmitted: true },
      reason: `could not write the neutralized source to ${input.finding.file}`,
    });
  }

  try {
    const run1 = executeTestRun(runOpts);
    const run2 = executeTestRun(runOpts);
    for (const [i, r] of [run1, run2].entries() as IterableIterator<[number, TestRunResult]>) {
      if (r.timedOut || r.spawnFailed) {
        return record(input, 'not-proven:execution-error', {
          testFiles: input.testFiles,
          neutralization: neutralized.id,
          controls: { suitePassesAsSubmitted: true, neutralizationApplied: true },
          reason: `neutralized run ${i + 1} did not complete (${r.timedOut ? 'timeout' : 'spawn failure'})`,
        });
      }
    }
    const classified = classifyErrorSwallow({
      suitePassesAsSubmitted: true,
      neutralizedRun1Failed: !run1.passed,
      neutralizedRun2Failed: !run2.passed,
      run1FailingTests: run1.failingTests,
      run2FailingTests: run2.failingTests,
    });
    const controls: ErrorSwallowControls = {
      suitePassesAsSubmitted: true,
      neutralizedFailsTwiceSameIdentity: classified.verdict === 'proven',
      neutralizationApplied: true,
    };
    return record(input, classified.verdict, {
      testFiles: input.testFiles,
      failingTests: classified.failingTests,
      neutralization: neutralized.id,
      controls,
      ...(classified.verdict === 'proven'
        ? {
            reason:
              `the added error swallow is load-bearing: rewriting it to re-throw (${neutralized.id}) ` +
              `makes ${classified.failingTests.join(', ')} fail twice with the same identity, ` +
              `where the submitted suite passed. Advisory: verify whether the masked failure is a ` +
              `concealed regression or an expected error the catch intends to absorb.`,
          }
        : classified.verdict === 'refuted'
          ? { reason: 'neutralizing the swallow left the affected test passing: the catch is not masking a test-visible failure' }
          : {}),
    });
  } finally {
    writeFile(filePath, original);
  }
}
