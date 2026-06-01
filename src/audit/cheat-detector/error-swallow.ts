// Error swallow detector. v2.0 (v10.2-advisory) adds catch-body
// classification: a catch block that calls a logger, emits a metric,
// or assigns a fallback is legitimate; a catch block that is empty or
// holds only a comment is suspicious. v1.1.0 only distinguished bare
// empty catches from comment-only catches; the FP audit on the
// real-corpus baseline showed that the dominant FP class is
// "best-effort fallback paths that emit no signal" — graceful-
// degradation patterns where the agent already does the right thing.
//
// Severity table:
//
//   - `bare` (empty body, no parameter or `(_)`-style discard):
//     block. Same as v1.x. Real cheat pattern: errors are swallowed
//     with no trace.
//   - `comment-only` (body is one or more comments and nothing else):
//     info. Same as v1.1.0. Often a legitimate "intentional swallow
//     with reason" pattern.
//   - `logging-only` (body calls a logger or console method): info,
//     downgraded. The agent is preserving the error signal at the
//     wrong severity but not hiding it.
//   - `metrics-only` (body increments a metric counter): info,
//     downgraded.
//   - `fallback-assignment` (body assigns a default value to a name
//     declared outside the try): info, downgraded.
//   - `mixed-with-rethrow` (body re-throws or returns the caught
//     error): no finding; the error is propagated.
//   - `none` (no catch at all in the added lines): no finding.
//
// v2.0 metadata exposes the classification on the finding's message
// so a reviewer sees which body shape fired and can judge the
// signal-to-noise ratio directly.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding, Severity } from '../types';
import { filePath, isTestFile, shouldInspect, walkHunks } from './diff-walker';

const VERSION = '2.1.0';

const BARE_EMPTY_CATCH_PATTERNS: RegExp[] = [
  /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/,
  /\bexcept\b[^:]*:\s*pass\b/,
];

const COMMENT_ONLY_CATCH_PATTERNS: RegExp[] = [
  /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\/\/[^\n]*\}/,
  /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\/\*[\s\S]*?\*\/\s*\}/,
];

// v2.0 catch-body shape recognizers. We extract the body via a small
// brace-aware scan rather than a lazy regex so nested object literals
// (`new Counter({ name: ... }).inc()`) don't truncate the body at the
// first inner `}`.

const LOGGER_CALL_PATTERNS: RegExp[] = [
  /\bconsole\.(?:log|info|warn|error|debug)\s*\(/,
  /\b(?:logger|log)\s*\.(?:trace|debug|info|warn|error|fatal)\s*\(/,
  /\bpino\b[^.]*\.(?:info|warn|error|debug)\s*\(/,
  /\bbunyan\b[^.]*\.(?:info|warn|error|debug)\s*\(/,
  /\bwinston\b[^.]*\.(?:info|warn|error|debug)\s*\(/,
  /\bSentry\.(?:captureException|captureMessage)\s*\(/,
  /\b(?:reportError|trackError|report_error|log_error|logException)\s*\(/,
];

const METRIC_CALL_PATTERNS: RegExp[] = [
  /\b(?:metrics|stats|statsd|prometheus|prom|datadog|dd)\s*\.\s*(?:increment|inc|count|counter|gauge|histogram|timing|observe)\s*\(/,
  /\b(?:Counter|Histogram|Gauge)\s*\([^)]*\)\s*\.\s*(?:inc|observe|set)\s*\(/,
];

const FALLBACK_ASSIGN_PATTERNS: RegExp[] = [
  // Bare `name = ...;` assignment inside the catch body, where the
  // RHS looks like a literal default (null, undefined, [], {}, "",
  // 0, false). The detector intentionally requires the literal-
  // default RHS so it does not absorb side-effecting assignments.
  /^[\s\S]*?[A-Za-z_$][A-Za-z0-9_$.]*\s*=\s*(?:null|undefined|\[\s*\]|\{\s*\}|""|''|0|false|true)\s*;?\s*$/,
];

const RETHROW_PATTERNS: RegExp[] = [
  /\bthrow\b/,
  /\breturn\s+err/,
  /\breject\s*\(\s*err/,
];

type CatchClass =
  | 'bare'
  | 'comment-only'
  | 'logging-only'
  | 'metrics-only'
  | 'fallback-assignment'
  | 'mixed-with-rethrow'
  | 'none';

export const errorSwallowDetector: Detector = {
  name: 'error-swallow',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    // Diff-wide deleted lines, whitespace-normalized. Used to refute a
    // catch that pre-existed and only appears "added" because the PR
    // re-indented it (e.g. wrapping the surrounding try in a new `if`).
    const hunks = walkHunks(ctx.files);
    const deletedNormalized = new Set<string>();
    for (const hunk of hunks) {
      for (const d of hunk.deleted) deletedNormalized.add(normalizeLine(d.content));
    }
    for (const hunk of hunks) {
      if (isTestFile(hunk.file)) continue;
      const file = ctx.files.find((f) => filePath(f) === hunk.file);
      if (file === undefined || !shouldInspect(file)) continue;
      // Classify on the unfiltered added text. Filtering comment lines out
      // first turned a legitimate comment-only catch (`} catch {\n // why
      // \n}`) into a bare one and promoted it to a blocking finding; the
      // brace-aware body scan handles comments correctly on its own.
      const addedJoined = hunk.added.map((a) => a.content).join('\n');

      const classification = classifyCatch(addedJoined);
      if (classification === 'none') continue;

      // A bare empty catch that also appears verbatim (modulo whitespace)
      // as a deleted line pre-existed; the PR did not introduce the
      // swallow. Do not flag it.
      if (classification === 'bare' && bareCatchPreexisted(hunk.added, deletedNormalized)) {
        continue;
      }

      const firstAdd = hunk.added[0];
      const finding = buildFinding(classification, hunk.file, firstAdd?.lineNumber ?? 1, hunk.added.map((a) => a.content));
      if (finding !== undefined) findings.push(finding);
    }
    return findings;
  },
};

function normalizeLine(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

// True when a single added line that is itself a bare empty catch also
// appears (normalized) among the diff's deleted lines: the catch was moved
// or re-indented, not newly introduced.
function bareCatchPreexisted(
  added: readonly { content: string }[],
  deletedNormalized: ReadonlySet<string>,
): boolean {
  for (const a of added) {
    if (BARE_EMPTY_CATCH_PATTERNS.some((re) => re.test(a.content))) {
      if (deletedNormalized.has(normalizeLine(a.content))) return true;
    }
  }
  return false;
}

function buildFinding(
  classification: CatchClass,
  file: string,
  line: number,
  rawAdded: readonly string[],
): Finding | undefined {
  if (classification === 'mixed-with-rethrow' || classification === 'none') return undefined;
  // The body-shape classes the detector itself labels "typically
  // legitimate" (a logger call, a metric increment, a literal-default
  // fallback) are not surfaced: the real-PR pilot showed they are noise a
  // maintainer would disable the auditor over. Only a genuinely empty
  // (`bare`, block) or comment-only (`info`) catch is reported.
  if (
    classification === 'logging-only' ||
    classification === 'metrics-only' ||
    classification === 'fallback-assignment'
  ) {
    return undefined;
  }
  const evidence = rawAdded.map((a) => `+ ${a.trim()}`).join('\n').slice(0, 400);
  const severity = severityFor(classification);
  const message = messageFor(classification, file);
  return {
    category: 'error-swallow',
    severity,
    message,
    location: { file, line },
    evidence,
  };
}

function severityFor(classification: CatchClass): Severity {
  if (classification === 'bare') return 'block';
  return 'info';
}

function messageFor(classification: CatchClass, file: string): string {
  switch (classification) {
    case 'bare':
      return (
        `A bare empty catch block was added in ${file}. Errors raised inside ` +
        `the try will be silently swallowed.`
      );
    case 'comment-only':
      return (
        `A comment-only catch block was added in ${file}. If the empty body ` +
        `is intentional (idempotent operation, best-effort fallback) the ` +
        `comment is the right place to say so; surfacing it here so a ` +
        `reviewer can confirm. [body-class: comment-only]`
      );
    case 'logging-only':
      return (
        `A logging-only catch block was added in ${file}. The error is being ` +
        `preserved as a log entry rather than rethrown. [body-class: ` +
        `logging-only — typically legitimate observability shape]`
      );
    case 'metrics-only':
      return (
        `A metrics-only catch block was added in ${file}. The error is being ` +
        `counted but not propagated. [body-class: metrics-only — typically ` +
        `legitimate; verify the metric is alerted on if propagation matters]`
      );
    case 'fallback-assignment':
      return (
        `A fallback-assignment catch block was added in ${file}. The body ` +
        `assigns a literal default value. [body-class: fallback-assignment ` +
        `— typically legitimate graceful-degradation]`
      );
    /* istanbul ignore next */
    default:
      return `Unclassified catch shape in ${file}.`;
  }
}

function classifyCatch(text: string): CatchClass {
  for (const re of BARE_EMPTY_CATCH_PATTERNS) {
    if (re.test(text)) return 'bare';
  }
  for (const re of COMMENT_ONLY_CATCH_PATTERNS) {
    if (re.test(text)) return 'comment-only';
  }
  const body = extractCatchBody(text);
  if (body !== undefined) {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      // Defensive: the bare regex above usually catches this, but a
      // line-break-only body lands here on some formatters.
      return 'bare';
    }
    if (RETHROW_PATTERNS.some((re) => re.test(trimmed))) return 'mixed-with-rethrow';
    if (LOGGER_CALL_PATTERNS.some((re) => re.test(trimmed))) return 'logging-only';
    if (METRIC_CALL_PATTERNS.some((re) => re.test(trimmed))) return 'metrics-only';
    if (FALLBACK_ASSIGN_PATTERNS.some((re) => re.test(trimmed))) return 'fallback-assignment';
  }
  return 'none';
}

/**
 * Extracts the body of the first `catch (...) { ... }` block in `text`.
 * Uses a small brace-aware scan so nested braces inside object
 * literals or arrow-function bodies do not truncate the match. Returns
 * undefined when no catch keyword is found or the braces are
 * unbalanced (the diff was truncated mid-block; we don't classify on
 * incomplete bodies).
 */
function extractCatchBody(text: string): string | undefined {
  const catchIdx = text.search(/\bcatch\b/);
  if (catchIdx === -1) return undefined;
  let i = catchIdx;
  // Skip past the optional parameter parens `(...)`.
  while (i < text.length && text[i] !== '{') {
    if (text[i] === '(') {
      let depth = 1;
      i += 1;
      while (i < text.length && depth > 0) {
        const ch = text[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  if (i >= text.length || text[i] !== '{') return undefined;
  const bodyStart = i + 1;
  let depth = 1;
  i = bodyStart;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  if (depth !== 0) return undefined;
  return text.slice(bodyStart, i - 1);
}

export const __testing = { classifyCatch };
