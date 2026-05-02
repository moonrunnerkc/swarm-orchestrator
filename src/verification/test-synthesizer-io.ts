import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../logger';
import type { FrameworkProfile } from './test-framework-detection';
import type { SynthesizedTestCandidate, TestSynthesisInput } from './test-synthesizer-types';

/**
 * Prompt construction, candidate JSON parsing, on-disk file emission, and
 * retry-feedback formatting for the test synthesizer. Lives in its own file
 * so `test-synthesizer.ts` can stay below the 300-line soft limit; the
 * stable run-loop in the parent module is short enough to read end-to-end
 * once the I/O concerns are extracted.
 */

const logger = getLogger('test-synthesizer');

// Candidate basename prefix. Underscores rather than hyphens because Python
// module names forbid hyphens, and the Django `tests/<app>/` placement path
// expects the file's basename (minus the `.py`) to be importable as a
// module by `tests/runtests.py <app>.<module>`. The session 2.5 design
// initially used hyphens (`swarm-synth-attempt-`) per the user precision;
// the v7 critical-path session 2.5 re-eval surfaced 3/3 Django records
// failing with `ModuleNotFoundError` because Django's loader rejected the
// hyphenated basenames. Underscores work in both Django (importable) and
// non-Django (path-only) placement, so the universal switch is the
// minimal fix. Cleanup-on-rejected and any future filename-grep
// attribution still match the prefix; the only externally visible
// difference is the separator. No consumer outside this file references
// the literal prefix today.
const SYNTH_TEST_PREFIX = 'swarm_synth_attempt';

/**
 * Discriminated rejection categories the synthesizer feeds back to the
 * adapter on retries. Phase 2's generic "test failed" feedback could not
 * tell the LLM whether to fix imports, rewrite the assertion, or
 * restructure the file; category-specific text gives the LLM something
 * actionable to course-correct from.
 */
export type RejectionCategory =
  | 'adapter-error'
  | 'json-parse-error'
  | 'collection-error'
  | 'passes-against-base';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const raw = fenced?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!raw || raw.trim() === '') {
    throw new Error('adapter output did not contain a JSON object');
  }
  return JSON.parse(raw);
}

/**
 * Parse the adapter's stdout into a structured candidate. Defaults the
 * `testFilePath` only — `testCommand` and `testSource` must be present and
 * non-empty, otherwise the run loop categorizes the parse as a
 * `json-parse-error` and feeds back to the LLM.
 */
export function parseCandidate(stdout: string): SynthesizedTestCandidate {
  const parsed = extractJsonObject(stdout);
  if (!isRecord(parsed)) {
    throw new Error('candidate JSON must be an object');
  }
  const testFilePath = parsed.testFilePath;
  const testCommand = parsed.testCommand;
  const testSource = parsed.testSource;
  if (typeof testCommand !== 'string' || testCommand.trim() === '') {
    throw new Error('candidate JSON must include non-empty testCommand');
  }
  if (typeof testSource !== 'string' || testSource.trim() === '') {
    throw new Error('candidate JSON must include non-empty testSource');
  }
  return {
    testFilePath:
      typeof testFilePath === 'string' && testFilePath.trim() !== ''
        ? testFilePath
        : 'synthesized-regression.test.js',
    testCommand,
    testSource,
  };
}

function safeBasename(candidatePath: string): string {
  return (
    path.basename(candidatePath).replace(/[^a-zA-Z0-9._-]/g, '-') ||
    'synthesized-regression.test.js'
  );
}

/**
 * Resolve the on-disk path for a candidate test file, branching on the
 * framework profile. `django-runtests` preserves the LLM's `testFilePath`
 * directory structure (with the swarm-synth-attempt-N- prefix on the
 * basename only) so Django's dotted-module loader can import the test;
 * everything else flattens to the repo root, the legacy default that the
 * `psf__requests-1766` `__file__`-resolving candidate depends on.
 *
 * Defensive fallback: an absolute or `..`-traversing path flattens
 * regardless. Last-line safety net so a malformed `testFilePath` cannot
 * write outside the worktree.
 */
function prefixedBasename(candidatePath: string, attemptNumber: number): string {
  const basename = safeBasename(candidatePath);
  return `${SYNTH_TEST_PREFIX}_${attemptNumber}_${basename}`;
}

function safeOutputPath(
  repoPath: string,
  candidatePath: string,
  attemptNumber: number,
  profile: FrameworkProfile,
): string {
  const prefixed = prefixedBasename(candidatePath, attemptNumber);
  if (!profile.preserveDirectoryStructure) {
    return path.join(repoPath, prefixed);
  }
  const dirPart = path.dirname(candidatePath);
  if (
    dirPart === '.' ||
    dirPart === '' ||
    dirPart.startsWith('/') ||
    path.normalize(dirPart).startsWith('..')
  ) {
    return path.join(repoPath, prefixed);
  }
  return path.join(repoPath, dirPart, prefixed);
}

function stemOf(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
}

/**
 * Rewrite the testCommand so any reference to the candidate's bare module
 * stem points at the prefixed stem. Required for Django: the LLM emits
 * `python tests/runtests.py <app>.<stem>`, the on-disk file uses the
 * prefixed basename, and Django's loader imports by the dotted name. With
 * no rewrite the dotted name resolves to a non-existent module. The
 * substitution is a single literal replace of the original stem; cases
 * where the stem is genuinely ambiguous (sub-string of an unrelated
 * identifier) are accepted as a known small risk in exchange for keeping
 * the rewrite simple and grep-able.
 *
 * Non-preserve frameworks do not need this: their testCommand references
 * the file path (already substituted), not a dotted module name.
 *
 * @param command - testCommand after `{{TEST_FILE}}` / path substitution.
 * @param originalStem - The candidate's basename without extension.
 * @param prefixedStem - The on-disk basename without extension (prefixed).
 * @returns The testCommand with the dotted reference rewritten.
 */
function rewriteDottedModuleStem(
  command: string,
  originalStem: string,
  prefixedStem: string,
): string {
  if (originalStem === prefixedStem || originalStem === '') return command;
  // First-occurrence replace; String.replace with a literal string only
  // hits the first match. The dotted name typically appears once, after
  // the runtests.py invocation.
  return command.replace(originalStem, prefixedStem);
}

const HARDCODED_VENV_PATTERN =
  /(^|[\s|;&])(?:\.\/)?(?:\.venv|venv)\/bin\/(python(?:3(?:\.\d+)?)?|pip3?|pytest)\b/g;

/**
 * Strip hardcoded relative `.venv/bin/<exe>` references from the LLM's
 * testCommand. The eval harness wraps PATH so bare `python` / `pytest`
 * already resolve to the per-instance venv; literal paths bypass the wrap
 * and fail in the gold worktree (no .venv there). Logs at WARN when the
 * rewrite fires so the prompt's "do not hardcode" guidance can be
 * observed for effectiveness — repeated firings mean the prompt needs
 * strengthening, zero firings mean the prompt is sufficient and the
 * rewrite is insurance.
 *
 * @param command - testCommand emitted by the LLM after `{{TEST_FILE}}` substitution.
 * @param instanceLogContext - Tag string surfaced in the WARN line for grep-ability.
 * @returns Sanitized command (or the original if nothing matched).
 */
export function sanitizeHardcodedVenv(command: string, instanceLogContext: string): string {
  let fired = false;
  const cleaned = command.replace(HARDCODED_VENV_PATTERN, (_match, lead: string, exe: string) => {
    fired = true;
    return `${lead}${exe}`;
  });
  if (fired) {
    logger.warn(
      'synthesizer testCommand referenced a hardcoded relative venv path; ' +
        `rewrote to bare executable. context=${instanceLogContext}, ` +
        `before=${JSON.stringify(command)}, after=${JSON.stringify(cleaned)}`,
    );
  }
  return cleaned;
}

export interface WrittenCandidate {
  absolutePath: string;
  relativePath: string;
  command: string;
}

/**
 * Persist the candidate to disk under the framework's placement rule, then
 * substitute `{{TEST_FILE}}` (or the literal candidate.testFilePath token)
 * in the testCommand and sanitize hardcoded venv references.
 *
 * @param repoPath - Absolute path to the persistent worktree the run executes in.
 * @param candidate - Parsed candidate object.
 * @param attemptNumber - 1-indexed attempt counter (becomes part of the basename).
 * @param profile - Framework profile dictating placement.
 * @param instanceLogContext - Tag passed through to sanitize for log grep-ability.
 * @returns Resolved on-disk path, repo-relative path, and the final shell command.
 */
export function writeCandidate(
  repoPath: string,
  candidate: SynthesizedTestCandidate,
  attemptNumber: number,
  profile: FrameworkProfile,
  instanceLogContext: string,
): WrittenCandidate {
  const absolutePath = safeOutputPath(repoPath, candidate.testFilePath, attemptNumber, profile);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, candidate.testSource, 'utf8');
  const relativePath = path.relative(repoPath, absolutePath);
  const fileSubstituted = candidate.testCommand.includes('{{TEST_FILE}}')
    ? candidate.testCommand.replace(/\{\{TEST_FILE\}\}/g, relativePath)
    : candidate.testCommand.replace(candidate.testFilePath, relativePath);
  // Frameworks that preserve directory structure (Django) reference the
  // candidate by dotted module name in testCommand, not by file path.
  // Rewrite the bare stem so the dotted reference matches the on-disk
  // prefixed basename. No-op for non-preserve frameworks because their
  // testCommand was already fully substituted by the file rewrite above.
  const moduleSubstituted = profile.preserveDirectoryStructure
    ? rewriteDottedModuleStem(
        fileSubstituted,
        stemOf(candidate.testFilePath),
        stemOf(absolutePath),
      )
    : fileSubstituted;
  const command = sanitizeHardcodedVenv(moduleSubstituted, instanceLogContext);
  return { absolutePath, relativePath, command };
}

function readRelevantFiles(
  repoPath: string,
  relevantFiles: string[] | undefined,
): string {
  if (!relevantFiles || relevantFiles.length === 0) return 'No relevant files were supplied.';
  const sections: string[] = [];
  for (const rel of relevantFiles.slice(0, 8)) {
    if (rel.startsWith('/') || path.normalize(rel).startsWith('..')) continue;
    const full = path.join(repoPath, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const body = fs.readFileSync(full, 'utf8').slice(0, 4_000);
    sections.push(`FILE: ${rel}\n\`\`\`\n${body}\n\`\`\``);
  }
  return sections.length > 0 ? sections.join('\n\n') : 'No readable relevant files were found.';
}

/**
 * Compose the synthesizer's user prompt. The framework profile's
 * `promptGuidance` is injected verbatim between the goal and the
 * relevant-files block so the LLM sees the placement and testCommand
 * conventions before it sees the source it has to test.
 */
export function buildPrompt(
  input: TestSynthesisInput,
  feedback: string | undefined,
  profile: FrameworkProfile,
): string {
  return `Generate one regression test for this goal:

${input.goalText}

${profile.promptGuidance}

Relevant source context:
${readRelevantFiles(input.targetRepoPath, input.relevantFiles)}

Return ONLY JSON with this schema:
{
  "testFilePath": "relative/path/to/regression.test.<ext>",
  "testCommand": "command that runs only this test; use {{TEST_FILE}} for the generated file path",
  "testSource": "complete test source"
}

The test must contain clear assertions, fail against the current codebase, and pass once the goal is correctly implemented.
${feedback ? `Previous attempt feedback: ${feedback}` : ''}`;
}

/**
 * Build the retry-feedback line the next attempt's prompt embeds. Detail
 * strings are trimmed and length-capped so noisy stderr does not blow up
 * the prompt budget.
 */
export function buildFeedback(category: RejectionCategory, detail: string): string {
  const trimmed = detail.trim().slice(0, 600);
  switch (category) {
    case 'adapter-error':
      return `Your previous attempt's process exited non-zero before producing JSON. Detail: ${trimmed}.`;
    case 'json-parse-error':
      return `Your previous attempt's output did not parse as the required JSON schema. Return ONLY the JSON object with no surrounding prose. Detail: ${trimmed}.`;
    case 'collection-error':
      return (
        "Your previous attempt's test could not be collected by pytest " +
        '(import error, missing fixture, syntax issue, or top-level statement that raises). ' +
        `Fix imports and module structure. pytest output: ${trimmed}.`
      );
    case 'passes-against-base':
      return (
        "Your previous attempt's test passed against the unfixed codebase, meaning it does not actually exercise the bug. " +
        'The test must FAIL against the current code and only PASS once the bug is fixed. ' +
        `Detail: ${trimmed}.`
      );
  }
}
