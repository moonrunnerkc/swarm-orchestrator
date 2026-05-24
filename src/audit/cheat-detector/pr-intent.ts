// PR-intent layer: severity escalation when the agent claims a fix.
// Parses the PR title and body for three vocabularies of fix-claim and
// returns a single intent record the engine post-processor uses to
// upgrade severities.
//
// Why this is regex and not NLP: the fix-claim surface is small,
// bounded by GitHub's documented close-keyword list plus a couple of
// common imperative prefixes. The detector cost of an NLP model on
// every audit run would dwarf the value of catching the long tail.
//
// Why this lives in cheat-detector/: it's consumed only by the cheat-
// detector engine and shares the audit-config + detector-context
// surface area. The renderer pulls the intent record back out of the
// upgraded findings through Finding.intentUpgraded (see ../types.ts).

const BODY_INSPECTION_BYTES = 500;

// Pattern 1: GitHub close-keyword followed by an issue reference. This
// is the canonical "fix-claim" — GitHub itself recognizes these in PR
// bodies to auto-close issues on merge.
const CLOSE_KEYWORD_PATTERN =
  /\b(?:fix(?:es|ed)?|close[ds]?|resolve[ds]?|patch(?:es|ed)?|address(?:es|ed)?)\s+#\d+/i;

// Pattern 2: Imperative-mood title prefix. "fix:", "resolves:", "closed:"
// — the prefix conventions agents adopt to flag a bug-fix PR. Requires
// a trailing colon (not just whitespace) so titles like "fixes #123:
// payment bug" fall through to the close-keyword pattern that captures
// the issue ref as evidence.
const IMPERATIVE_TITLE_PATTERN =
  /^\s*(?:fix(?:es|ed)?|resolve[ds]?|close[ds]?)\s*:/i;

// Pattern 3: Body sentence leading with "this PR fixes/resolves/closes".
// Constrained to the first BODY_INSPECTION_BYTES of body so a long
// dependency-update body that incidentally mentions "this PR" later
// doesn't trigger.
const BODY_LEAD_PATTERN =
  /(?:^|\.\s+|\n\s*)this\s+pr\s+(?:fix(?:es|ed)?|resolve[ds]?|close[ds]?)\b/i;

export interface PrIntent {
  claimsFix: boolean;
  /**
   * Matched substring from the title or body that triggered the
   * claim. Quoted back to the user in the renderer note so they can
   * see the agent's own words. Empty when `claimsFix` is false.
   */
  evidence: string;
}

export interface PrIntentInput {
  title?: string;
  body?: string;
}

export function parsePrIntent(input: PrIntentInput | undefined): PrIntent {
  if (input === undefined) return { claimsFix: false, evidence: '' };
  const title = (input.title ?? '').trim();
  const body = input.body ?? '';
  const bodyHead = body.slice(0, BODY_INSPECTION_BYTES);

  // Title-side checks: imperative prefix first, then close-keyword anywhere.
  const titleImperative = title.match(IMPERATIVE_TITLE_PATTERN);
  if (titleImperative !== null) {
    return { claimsFix: true, evidence: trimEvidence(titleImperative[0]) };
  }
  const titleClose = title.match(CLOSE_KEYWORD_PATTERN);
  if (titleClose !== null) {
    return { claimsFix: true, evidence: trimEvidence(titleClose[0]) };
  }

  // Body-side checks: close-keyword anywhere in head, then leading
  // "this PR fixes/..." sentence.
  const bodyClose = bodyHead.match(CLOSE_KEYWORD_PATTERN);
  if (bodyClose !== null) {
    return { claimsFix: true, evidence: trimEvidence(bodyClose[0]) };
  }
  const bodyLead = bodyHead.match(BODY_LEAD_PATTERN);
  if (bodyLead !== null) {
    return { claimsFix: true, evidence: trimEvidence(bodyLead[0]) };
  }

  return { claimsFix: false, evidence: '' };
}

function trimEvidence(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

// Severity policy. The engine applies this post-hoc to each finding
// after the detector returns, so individual detectors don't need to
// know about PRs. `block` is terminal: no policy can downgrade it
// here. Policy `off` disables the layer entirely.
export type IntentSeverityPolicy = 'strict' | 'lenient' | 'off';

export type Severity = 'block' | 'warn' | 'info';

export function upgradeSeverity(
  current: Severity,
  intent: PrIntent,
  policy: IntentSeverityPolicy,
): Severity {
  if (policy === 'off') return current;
  if (!intent.claimsFix) return current;
  if (current === 'block') return current;
  if (policy === 'strict') {
    if (current === 'warn') return 'block';
    if (current === 'info') return 'warn';
  }
  if (policy === 'lenient') {
    // Lenient shifts the upgrades down one level: warn still escalates
    // to block, but info is left alone. Documented in audit-config.md.
    if (current === 'warn') return 'block';
  }
  return current;
}
