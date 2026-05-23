// Fingerprints which AI agent opened a PR, by inspecting commit
// metadata, branch naming, PR title/body markers, and the GitHub author
// (for bot users). Returns an `AuditAgentAttribution` with a confidence
// level so the leaderboard can mark uncertain rows.
//
// Detection order: highest-specificity signal wins. A bot author like
// `devin-ai-integration[bot]` is unambiguous and beats branch-name
// heuristics. We never make a guess at `low` confidence unless every
// stronger signal was absent.

import type { AuditAgentAttribution } from '../types';

export interface PrSourceInput {
  prTitle?: string;
  prBody?: string;
  headRef?: string;
  commitMessages?: string[];
  authors?: string[];
}

interface AgentSignature {
  vendor: string;
  // Bot-author exact matches (case-insensitive). Highest priority.
  authors?: RegExp[];
  // PR body / commit message marker patterns.
  bodyMarkers?: RegExp[];
  // Branch-prefix patterns.
  branchPatterns?: RegExp[];
  // Commit-message patterns.
  commitPatterns?: RegExp[];
  versionExtractor?: (text: string) => string | undefined;
}

const SIGNATURES: AgentSignature[] = [
  {
    vendor: 'devin',
    authors: [/^devin-ai-integration\[bot\]$/i, /^devin\[bot\]$/i],
    bodyMarkers: [/devin\.ai/i, /\bopened by Devin\b/i],
    branchPatterns: [/^devin\//i],
  },
  {
    vendor: 'claude-code',
    authors: [/^claude-code\[bot\]$/i, /^claude\[bot\]$/i],
    bodyMarkers: [
      /Generated with \[?Claude Code\]?/i,
      /claude\.com\/claude-code/i,
      /Co-Authored-By:\s*Claude/i,
    ],
    commitPatterns: [
      /Co-Authored-By:\s*Claude/i,
      /Generated with \[?Claude Code\]?/i,
    ],
    branchPatterns: [/^claude\//i, /^claude-code\//i],
    versionExtractor: (text) => {
      const m = text.match(/(?:Opus|Sonnet|Haiku)[^\d]{0,5}([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
      return m?.[1];
    },
  },
  {
    vendor: 'cursor',
    authors: [/^cursor\[bot\]$/i, /^cursoragent\[bot\]$/i],
    bodyMarkers: [/cursor\.com\/agent/i, /\bCursor Agent\b/i, /\bopened by Cursor\b/i],
    branchPatterns: [/^cursor\//i],
  },
  {
    vendor: 'aider',
    bodyMarkers: [/\baider\b.*\b(committed|generated)\b/i, /aider\.chat/i],
    commitPatterns: [/^aider:/i, /aider\.chat/i],
    branchPatterns: [/^aider\//i],
  },
  {
    vendor: 'codex-cli',
    bodyMarkers: [/\bopenai\/codex\b/i, /\bcodex cli\b/i, /\bcodex_session_id\b/i],
    commitPatterns: [/codex_session_id/i],
    branchPatterns: [/^codex\//i],
  },
  {
    vendor: 'copilot-workspace',
    authors: [/^copilot-swe-agent\[bot\]$/i, /^github-copilot\[bot\]$/i],
    bodyMarkers: [/copilot workspace/i, /github\.com\/features\/copilot/i],
    branchPatterns: [/^copilot\//i],
  },
  {
    vendor: 'replit-agent',
    authors: [/^replit-agent\[bot\]$/i],
    bodyMarkers: [/replit\.com\/.*agent/i, /\bReplit Agent\b/i],
  },
  {
    vendor: 'openhands',
    authors: [/^openhands-agent\[bot\]$/i],
    bodyMarkers: [/all-hands\.dev/i, /\bOpenHands\b/i],
    branchPatterns: [/^openhands\//i],
  },
];

export function detectAgent(input: PrSourceInput): AuditAgentAttribution | undefined {
  const bodyText = [input.prTitle ?? '', input.prBody ?? ''].join('\n');
  const commitText = (input.commitMessages ?? []).join('\n');
  const branch = input.headRef ?? '';
  const authors = input.authors ?? [];

  for (const sig of SIGNATURES) {
    const authorHit = sig.authors !== undefined && authors.some((a) => sig.authors!.some((re) => re.test(a)));
    if (authorHit) {
      const attribution: AuditAgentAttribution = {
        vendor: sig.vendor,
        confidence: 'high',
        source: 'bot-author',
      };
      const version = sig.versionExtractor?.(`${bodyText}\n${commitText}`);
      if (version !== undefined) attribution.version = version;
      return attribution;
    }
  }

  for (const sig of SIGNATURES) {
    const bodyHit = (sig.bodyMarkers ?? []).some((re) => re.test(bodyText));
    const commitHit = (sig.commitPatterns ?? []).some((re) => re.test(commitText));
    if (bodyHit || commitHit) {
      const attribution: AuditAgentAttribution = {
        vendor: sig.vendor,
        confidence: 'high',
        source: bodyHit ? 'pr-body-marker' : 'commit-marker',
      };
      const version = sig.versionExtractor?.(`${bodyText}\n${commitText}`);
      if (version !== undefined) attribution.version = version;
      return attribution;
    }
  }

  for (const sig of SIGNATURES) {
    const branchHit = (sig.branchPatterns ?? []).some((re) => re.test(branch));
    if (branchHit) {
      const attribution: AuditAgentAttribution = {
        vendor: sig.vendor,
        confidence: 'medium',
        source: 'branch-name',
      };
      const version = sig.versionExtractor?.(`${bodyText}\n${commitText}`);
      if (version !== undefined) attribution.version = version;
      return attribution;
    }
  }

  return undefined;
}

export const KNOWN_VENDORS: readonly string[] = SIGNATURES.map((s) => s.vendor);
