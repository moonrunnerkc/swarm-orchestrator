/**
 * Fatal-error classification for agent CLI failures.
 *
 * An agent run can fail in two distinct ways:
 *
 *   1. Recoverable: the agent ran but produced a bad patch. The orchestrator's
 *      replan and repair loops can usefully retry.
 *
 *   2. Unrecoverable: the agent never ran (or refused to run) because of an
 *      account-level condition such as a usage-limit hit, an expired
 *      subscription, or a missing API key. No amount of replanning will
 *      change that, and each replan still consumes the per-instance budget.
 *
 * This module turns the second case into a structured signal so the
 * orchestrator can short-circuit instead of burning the 10-minute
 * dependency-wait window per replan step.
 *
 * Patterns are matched against the union of stdout + stderr because the
 * three CLIs we wrap split error reporting differently:
 *   - codex prints `ERROR: You've hit your usage limit. Upgrade to Pro ...`
 *     on stderr.
 *   - claude prints rate-limit / auth errors with a `429` or `401` token in
 *     either stream depending on transport.
 *   - copilot prints `gh: authentication required` on stderr and `403`
 *     bodies on stdout.
 *
 * Patterns are intentionally narrow. False positives here would suppress
 * legitimate retries on transient errors, which is worse than the current
 * 10-minute wait it's trying to avoid.
 */

export type FatalAgentErrorKind = 'usage-limit' | 'auth' | 'rate-limit-extended';

export interface FatalAgentError {
  /** Coarse category used by the orchestrator to decide messaging and exit semantics. */
  kind: FatalAgentErrorKind;
  /** Excerpt of the agent's own error text, trimmed for log readability. */
  message: string;
  /** The line that matched the classifier, useful for postmortem reports. */
  evidence: string;
}

interface ClassifierPattern {
  kind: FatalAgentErrorKind;
  pattern: RegExp;
}

// Order matters: more specific patterns first. The first match wins.
const PATTERNS: ClassifierPattern[] = [
  // Codex CLI usage-limit message. Verbatim from `codex exec` stderr when an
  // OpenAI account hits its plan ceiling — the only actionable response is
  // "wait until <reset time> or upgrade", neither of which the orchestrator
  // can do mid-sweep. See smoke run 2026-04-28-codex stderr.
  { kind: 'usage-limit', pattern: /you'?ve hit your usage limit/i },
  { kind: 'usage-limit', pattern: /upgrade to (pro|plus|team)\b/i },
  { kind: 'usage-limit', pattern: /quota.*(exceed|exhaust)/i },
  { kind: 'usage-limit', pattern: /monthly limit reached/i },

  // Auth: missing/invalid credentials. The agent CLI cannot recover by
  // retrying with the same credentials.
  { kind: 'auth', pattern: /\b401\s+unauthorized\b/i },
  { kind: 'auth', pattern: /\b403\s+forbidden\b/i },
  { kind: 'auth', pattern: /authentication\s+(required|failed)/i },
  { kind: 'auth', pattern: /invalid api[_-]?key/i },
  { kind: 'auth', pattern: /api[_-]?key.*(missing|not found|not set)/i },
  { kind: 'auth', pattern: /not (logged in|authenticated)/i },

  // Rate limit with a retry-after window we cannot wait through within a
  // smoke task budget. Matches "try again at HH:MM (PM|AM)" from codex and
  // "rate limit reached.*retry-after: \d{4,}" from anthropic-style payloads.
  { kind: 'rate-limit-extended', pattern: /try again at \d{1,2}:\d{2}\s*(am|pm)/i },
  { kind: 'rate-limit-extended', pattern: /retry-after:\s*\d{4,}/i },
];

/**
 * Inspect agent CLI output for unrecoverable error signatures.
 *
 * @param stdout combined stdout from the agent process. Pass an empty string when unavailable.
 * @param stderr combined stderr from the agent process. Pass an empty string when unavailable.
 * @param exitCode process exit code; only consulted to gate detection (zero exit means the
 *   agent reported success, and we do not classify a successful run as fatal).
 * @returns a FatalAgentError when a known pattern matches, otherwise undefined.
 */
export function classifyFatalAgentError(
  stdout: string,
  stderr: string,
  exitCode: number,
): FatalAgentError | undefined {
  if (exitCode === 0) return undefined;

  const haystack = `${stderr ?? ''}\n${stdout ?? ''}`;
  if (!haystack.trim()) return undefined;

  for (const { kind, pattern } of PATTERNS) {
    const match = haystack.match(pattern);
    if (!match) continue;

    const lineStart = haystack.lastIndexOf('\n', match.index ?? 0) + 1;
    const lineEndRaw = haystack.indexOf('\n', (match.index ?? 0) + match[0].length);
    const lineEnd = lineEndRaw === -1 ? haystack.length : lineEndRaw;
    const evidence = haystack.slice(lineStart, lineEnd).trim().slice(0, 240);

    return {
      kind,
      message: evidence || match[0],
      evidence,
    };
  }

  return undefined;
}
