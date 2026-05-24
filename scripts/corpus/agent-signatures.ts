// Agent attribution signatures + two-signal rule for the v10.1 real-PR
// collector. Pure functions; no I/O. The collector and any downstream
// auditor that wants to apply the same attribution policy share this
// module rather than re-deriving the predicate set.
//
// Each profile declares one or more *primary* signals and one or more
// *secondary* signals against a `PrSignalInput` (the same shape
// `src/cli/v8/pr-fetch.ts#fetchPrContext` returns as `fingerprintInput`).
// The two-signal rule: a PR is auto-accepted only when at least one
// primary AND at least one secondary signal fire. Primary-only or
// secondary-only candidates are marked `unconfirmed` so the collector
// can route them to a manual-review queue rather than dropping them.
//
// Bot handles below are based on each vendor's public docs at the time
// of writing. Profiles carry a `verifyHandle: true` flag where the
// exact GitHub-App login should be re-confirmed against vendor
// documentation before the collector runs in production.

import type { AttributionConfidence } from '../../benchmarks/real-corpus/schema';

export interface PrSignalInput {
  prTitle: string;
  prBody: string;
  headRef: string;
  authors: readonly string[];
  commitMessages: readonly string[];
  /** `owner/repo` slug; matched against per-agent org allow-lists. */
  repository: string;
}

export interface SignalMatch {
  /** Short label for the matched signal (used in the audit `source` field). */
  label: string;
  /** Substring or pattern that fired, for human-readable evidence. */
  evidence: string;
}

export type SignalPredicate = (input: PrSignalInput) => SignalMatch | null;

export interface AgentProfile {
  vendor: string;
  confidence: AttributionConfidence;
  primary: readonly SignalPredicate[];
  secondary: readonly SignalPredicate[];
  /** True when the bot account / handle should be reconfirmed before use. */
  verifyHandle?: boolean;
}

export type AttributionVerdict =
  | {
      kind: 'accepted';
      vendor: string;
      confidence: AttributionConfidence;
      source: string;
      primaryMatch: SignalMatch;
      secondaryMatch: SignalMatch;
    }
  | {
      kind: 'unconfirmed';
      vendor: string;
      confidence: AttributionConfidence;
      source: string;
      primaryMatch?: SignalMatch;
      secondaryMatch?: SignalMatch;
    }
  | { kind: 'rejected' };

// --- Signal predicate helpers ------------------------------------------------

function authorMatches(handles: readonly string[]): SignalPredicate {
  const set = new Set(handles.map((h) => h.toLowerCase()));
  return (input) => {
    for (const author of input.authors) {
      const lc = author.toLowerCase();
      if (set.has(lc) || set.has(lc.replace(/\[bot\]$/, ''))) {
        return { label: `author=${author}`, evidence: author };
      }
    }
    return null;
  };
}

function bodyContains(needle: string, label: string): SignalPredicate {
  const lc = needle.toLowerCase();
  return (input) => {
    if (input.prBody.toLowerCase().includes(lc)) {
      return { label, evidence: needle };
    }
    return null;
  };
}

function bodyMatches(pattern: RegExp, label: string): SignalPredicate {
  return (input) => {
    const m = input.prBody.match(pattern);
    if (m !== null) return { label, evidence: m[0] };
    return null;
  };
}

function titleStartsWith(prefix: string, label: string): SignalPredicate {
  const lc = prefix.toLowerCase();
  return (input) => {
    if (input.prTitle.toLowerCase().startsWith(lc)) {
      return { label, evidence: prefix };
    }
    return null;
  };
}

function headRefStartsWith(prefix: string, label: string): SignalPredicate {
  return (input) => {
    if (input.headRef.startsWith(prefix)) {
      return { label, evidence: input.headRef };
    }
    return null;
  };
}

function commitFooterMatches(pattern: RegExp, label: string): SignalPredicate {
  return (input) => {
    for (const msg of input.commitMessages) {
      const m = msg.match(pattern);
      if (m !== null) return { label, evidence: m[0] };
    }
    return null;
  };
}

function commitMessageStartsWith(prefix: string, label: string): SignalPredicate {
  const lc = prefix.toLowerCase();
  return (input) => {
    for (const msg of input.commitMessages) {
      if (msg.toLowerCase().startsWith(lc)) {
        return { label, evidence: prefix };
      }
    }
    return null;
  };
}

function repositoryOwnerIn(owners: readonly string[]): SignalPredicate {
  const set = new Set(owners.map((o) => o.toLowerCase()));
  return (input) => {
    const [owner] = input.repository.split('/');
    if (owner !== undefined && set.has(owner.toLowerCase())) {
      return { label: `repo-owner=${owner}`, evidence: input.repository };
    }
    return null;
  };
}

// --- Profiles ----------------------------------------------------------------

export const AGENT_PROFILES: readonly AgentProfile[] = [
  {
    vendor: 'claude-code',
    confidence: 'high',
    primary: [
      bodyContains('🤖 Generated with [Claude Code]', 'body=claude-code-footer'),
      commitFooterMatches(
        /Co-Authored-By:\s*Claude\s*<noreply@anthropic\.com>/i,
        'commit=claude-coauthor',
      ),
    ],
    secondary: [
      headRefStartsWith('claude/', 'branch=claude/'),
      repositoryOwnerIn(['anthropics', 'anthropic-ai']),
    ],
  },
  {
    vendor: 'devin',
    confidence: 'high',
    verifyHandle: true,
    primary: [authorMatches(['devin-ai-integration[bot]', 'devin-ai-integration'])],
    secondary: [
      bodyMatches(/https?:\/\/(?:app\.)?devin\.ai\/[^\s)]+/i, 'body=devin-session-url'),
      bodyContains('Devin run by', 'body=devin-attribution'),
    ],
  },
  {
    vendor: 'copilot-workspace',
    confidence: 'high',
    verifyHandle: true,
    primary: [
      authorMatches([
        'copilot-swe-agent[bot]',
        'copilot-swe-agent',
        'github-copilot[bot]',
      ]),
    ],
    secondary: [
      bodyContains('Copilot Workspace', 'body=copilot-workspace-footer'),
      bodyMatches(/https?:\/\/copilot-workspace\.githubnext\.com\/[^\s)]+/i, 'body=copilot-session-url'),
    ],
  },
  {
    vendor: 'openhands',
    confidence: 'high',
    verifyHandle: true,
    primary: [
      authorMatches(['openhands-agent[bot]', 'openhands-agent', 'openhands[bot]']),
      repositoryOwnerIn(['all-hands-ai']),
    ],
    secondary: [
      bodyContains('OpenHands', 'body=openhands-attribution'),
      bodyMatches(/https?:\/\/(?:app\.)?all-hands\.dev\/[^\s)]+/i, 'body=openhands-session-url'),
    ],
  },
  {
    vendor: 'aider',
    confidence: 'high',
    primary: [
      commitMessageStartsWith('aider:', 'commit=aider-prefix'),
      commitFooterMatches(/aider:\s*[A-Za-z][^\n]+/i, 'commit=aider-footer'),
    ],
    secondary: [
      headRefStartsWith('aider/', 'branch=aider/'),
      repositoryOwnerIn(['aider-ai', 'paul-gauthier']),
    ],
  },
  {
    vendor: 'cursor',
    confidence: 'medium',
    primary: [
      headRefStartsWith('cursor/', 'branch=cursor/'),
      bodyContains('Generated by Cursor', 'body=cursor-attribution'),
    ],
    secondary: [
      bodyMatches(/https?:\/\/cursor\.com\/[^\s)]+/i, 'body=cursor-session-url'),
      bodyContains('cursor.com', 'body=cursor-link'),
    ],
  },
  {
    vendor: 'codex-cli',
    confidence: 'medium',
    primary: [
      commitFooterMatches(/Codex CLI/i, 'commit=codex-cli-footer'),
      titleStartsWith('codex:', 'title=codex-prefix'),
    ],
    secondary: [
      bodyContains('```codex', 'body=codex-transcript-block'),
      repositoryOwnerIn(['openai']),
    ],
  },
  {
    vendor: 'replit-agent',
    confidence: 'low',
    primary: [
      bodyContains('Replit Agent', 'body=replit-agent-footer'),
      bodyMatches(/https?:\/\/replit\.com\/@[^\s)]+/i, 'body=replit-deploy-link'),
    ],
    secondary: [headRefStartsWith('replit/', 'branch=replit/')],
  },
];

/**
 * Apply the two-signal rule against every profile. Returns the first
 * profile whose primary+secondary both fire; otherwise returns the
 * first profile whose primary OR secondary fires alone as
 * `unconfirmed`. Returns `rejected` when no profile matches at all.
 *
 * Order of profiles in `AGENT_PROFILES` is the priority tiebreaker.
 * Vendor-showcase repos (Anthropic, All-Hands-AI, paul-gauthier) tend
 * to have multiple co-authors so a tie is uncommon in practice.
 */
export function attributeAgent(input: PrSignalInput): AttributionVerdict {
  let firstPartial: AttributionVerdict | null = null;
  for (const profile of AGENT_PROFILES) {
    const primaryMatch = firstMatch(profile.primary, input);
    const secondaryMatch = firstMatch(profile.secondary, input);
    if (primaryMatch !== null && secondaryMatch !== null) {
      return {
        kind: 'accepted',
        vendor: profile.vendor,
        confidence: profile.confidence,
        source: `${primaryMatch.label}+${secondaryMatch.label}`,
        primaryMatch,
        secondaryMatch,
      };
    }
    if (firstPartial === null && (primaryMatch !== null || secondaryMatch !== null)) {
      const sourceParts: string[] = [];
      if (primaryMatch !== null) sourceParts.push(primaryMatch.label);
      if (secondaryMatch !== null) sourceParts.push(secondaryMatch.label);
      const partial: AttributionVerdict = {
        kind: 'unconfirmed',
        vendor: profile.vendor,
        confidence: profile.confidence,
        source: sourceParts.join('+'),
      };
      if (primaryMatch !== null) partial.primaryMatch = primaryMatch;
      if (secondaryMatch !== null) partial.secondaryMatch = secondaryMatch;
      firstPartial = partial;
    }
  }
  return firstPartial ?? { kind: 'rejected' };
}

function firstMatch(
  predicates: readonly SignalPredicate[],
  input: PrSignalInput,
): SignalMatch | null {
  for (const p of predicates) {
    const m = p(input);
    if (m !== null) return m;
  }
  return null;
}
