// Project-level audit configuration. Read from `.swarm/audit-config.yaml`
// at the repo root (when present); silently absent otherwise. Two
// supported fields:
//   - `excludePaths`: list of glob patterns exempted from cheat detection
//     on top of the engine's built-in subject-path filter.
//   - `intentSeverityPolicy`: 'strict' | 'lenient' | 'off' (default
//     'strict'), controls the PR-intent severity-upgrade layer that
//     escalates findings when the agent's PR body claims a fix. See
//     pr-intent.ts and docs/audit-config.md.
//
// The intended use of excludePaths is for repos whose own source code
// legitimately contains literal cheat patterns: detector tests with
// embedded fixture diffs, rule packs that quote `if (false)` as
// documentation, generator scripts that emit broken patches by design.
// Without this hook those files force the dogfood audit to self-block
// on every commit and there is no way to fix the root cause without
// rewriting the detector to be AST-aware (out of scope for the regex
// engine).
//
// The glob syntax is minimal on purpose: `*` matches a path segment
// except `/`, `**` matches any number of segments. Anchored at the
// repo root unless the pattern begins with `**/`. Patterns are
// case-sensitive (paths on Linux/macOS are case-sensitive; Windows
// callers should write patterns to match).

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../logger';
import type { IntentSeverityPolicy } from './pr-intent';
import { SEMANTIC_CHEAT_CATEGORIES, type SemanticCheatCategory } from '../types';

const CONFIG_FILE = path.join('.swarm', 'audit-config.yaml');
const DEFAULT_INTENT_POLICY: IntentSeverityPolicy = 'strict';

/** Controls the judge-primary path for the semantic categories. Default
 *  on so semantic cheats are caught out of the box; a cost-sensitive
 *  consumer sets `enabled: false` to keep the audit deterministic.
 *
 *  `block` is off by default: judge-primary findings ship advisory
 *  (severity `warn`) until a consumer has its own per-repo false-positive
 *  data to justify promotion. A consumer that has measured the path on its
 *  own merged-PR window flips `block: true` to make these findings gate.
 *  See docs/audit/methodology.md for the measurement bar. */
export interface JudgePrimaryConfig {
  enabled: boolean;
  block: boolean;
  categories: readonly SemanticCheatCategory[];
}

/** Controls the execution-grounded checks (mutation testing, issue-linked
 *  repro, coverage delta). Off by default: these provision a sandboxed
 *  checkout and run the repo's suite, so they are for evidence runs and deep
 *  audits, not every PR. When enabled, the three checks default on and a PR's
 *  total wall-clock is capped (Stryker can run long on a large change). */
export interface ExecutionGroundedConfig {
  enabled: boolean;
  mutation: boolean;
  issueRepro: boolean;
  coverage: boolean;
  maxWallClockPerPrMs: number;
  /** Where the untrusted-execution checks (mutation, coverage, issue-repro)
   *  run. `host` (default) runs them directly with a secret-scrubbed env.
   *  `docker` runs them inside a container built from the repo Dockerfile,
   *  with only the checkout bind-mounted and the network locked down. The
   *  docker path is skipped cleanly when docker is unavailable. */
  runner: 'host' | 'docker';
  /** Correlate structural cheat findings with this run's execution signals
   *  (a surviving mutant, a coverage gap, a still-failing repro) and mark the
   *  ones with runtime backing. Off by default; only takes effect when the
   *  execution-grounded layer actually ran. Raises a corroborated finding's
   *  confidence without touching uncorroborated findings, which stay advisory. */
  corroborateStructural: boolean;
}

export interface AuditConfig {
  excludePaths: readonly string[];
  intentSeverityPolicy: IntentSeverityPolicy;
  judgePrimary: JudgePrimaryConfig;
  executionGrounded: ExecutionGroundedConfig;
}

const DEFAULT_JUDGE_PRIMARY: JudgePrimaryConfig = {
  enabled: true,
  block: false,
  categories: SEMANTIC_CHEAT_CATEGORIES,
};

const DEFAULT_EXECUTION_GROUNDED: ExecutionGroundedConfig = {
  enabled: false,
  mutation: true,
  issueRepro: true,
  coverage: true,
  maxWallClockPerPrMs: 30 * 60 * 1000,
  runner: 'host',
  corroborateStructural: false,
};

const EMPTY_CONFIG: AuditConfig = {
  excludePaths: [],
  intentSeverityPolicy: DEFAULT_INTENT_POLICY,
  judgePrimary: DEFAULT_JUDGE_PRIMARY,
  executionGrounded: DEFAULT_EXECUTION_GROUNDED,
};

export function loadAuditConfig(repoRoot: string): AuditConfig {
  const file = path.join(repoRoot, CONFIG_FILE);
  if (!fs.existsSync(file)) return EMPTY_CONFIG;
  const text = fs.readFileSync(file, 'utf8');
  const excludePaths = parseExcludePaths(text);
  const intentSeverityPolicy = parseIntentSeverityPolicy(text);
  const judgePrimary = parseJudgePrimary(text);
  const executionGrounded = parseExecutionGrounded(text);
  warnIfUnrecognized(file, text, excludePaths);
  return { excludePaths, intentSeverityPolicy, judgePrimary, executionGrounded };
}

// Parses the optional `executionGrounded:` block:
//
//   executionGrounded:
//     enabled: true
//     mutation: true
//     issueRepro: true
//     coverage: true
//     maxWallClockPerPrMs: 1800000
//
// Absent -> the default (disabled). When `enabled: true` with the sub-flags
// omitted, all three checks run and the wall-clock cap defaults to 30 min.
function parseExecutionGrounded(text: string): ExecutionGroundedConfig {
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  let seen = false;
  const cfg: ExecutionGroundedConfig = { ...DEFAULT_EXECUTION_GROUNDED };
  for (const rawLine of lines) {
    const trimmed = rawLine.replace(/#.*$/, '').trim();
    if (/^executionGrounded\s*:/.test(trimmed)) {
      inBlock = true;
      seen = true;
      continue;
    }
    if (!inBlock) continue;
    if (trimmed.length > 0 && !/^\s/.test(rawLine)) break;
    const boolMatch = trimmed.match(
      /^(enabled|mutation|issueRepro|coverage|corroborateStructural)\s*:\s*(true|false)\s*$/i,
    );
    if (boolMatch && boolMatch[1] !== undefined && boolMatch[2] !== undefined) {
      cfg[boolMatch[1] as 'enabled' | 'mutation' | 'issueRepro' | 'coverage' | 'corroborateStructural'] =
        boolMatch[2].toLowerCase() === 'true';
      continue;
    }
    const numMatch = trimmed.match(/^maxWallClockPerPrMs\s*:\s*(\d+)\s*$/);
    if (numMatch && numMatch[1] !== undefined) {
      cfg.maxWallClockPerPrMs = Number.parseInt(numMatch[1], 10);
      continue;
    }
    const runnerMatch = trimmed.match(/^runner\s*:\s*(['"]?)(host|docker)\1\s*$/i);
    if (runnerMatch && runnerMatch[2] !== undefined) {
      cfg.runner = runnerMatch[2].toLowerCase() === 'docker' ? 'docker' : 'host';
    }
  }
  return seen ? cfg : DEFAULT_EXECUTION_GROUNDED;
}

// Parses the optional `judgePrimary:` block:
//
//   judgePrimary:
//     enabled: true
//     block: false
//     categories: [goal-not-fixed, cheat-mock-mutation]
//
// Absent block -> default (enabled, advisory, both categories). A present
// block with `enabled: false` turns the path off; `block: true` promotes
// judge-primary findings from advisory `warn` to gating `block`.
// `categories` accepts an inline array or a YAML block list; unknown
// category names are dropped.
function parseJudgePrimary(text: string): JudgePrimaryConfig {
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  let enabled = DEFAULT_JUDGE_PRIMARY.enabled;
  let block = DEFAULT_JUDGE_PRIMARY.block;
  let categories: SemanticCheatCategory[] | undefined;
  let inCategoryList = false;
  const seenBlock = { value: false };
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '');
    const trimmed = line.trim();
    if (/^judgePrimary\s*:/.test(trimmed)) {
      inBlock = true;
      seenBlock.value = true;
      continue;
    }
    if (!inBlock) continue;
    // A non-indented, non-empty line ends the block.
    if (trimmed.length > 0 && !/^\s/.test(rawLine) && !/^judgePrimary/.test(trimmed)) {
      break;
    }
    const enabledMatch = trimmed.match(/^enabled\s*:\s*(true|false)\s*$/i);
    if (enabledMatch && enabledMatch[1] !== undefined) {
      enabled = enabledMatch[1].toLowerCase() === 'true';
      inCategoryList = false;
      continue;
    }
    const blockMatch = trimmed.match(/^block\s*:\s*(true|false)\s*$/i);
    if (blockMatch && blockMatch[1] !== undefined) {
      block = blockMatch[1].toLowerCase() === 'true';
      inCategoryList = false;
      continue;
    }
    const inlineCats = trimmed.match(/^categories\s*:\s*\[(.*)\]\s*$/);
    if (inlineCats && inlineCats[1] !== undefined) {
      categories = toSemanticCategories(inlineCats[1].split(','));
      inCategoryList = false;
      continue;
    }
    if (/^categories\s*:\s*$/.test(trimmed)) {
      categories = [];
      inCategoryList = true;
      continue;
    }
    if (inCategoryList) {
      const item = trimmed.match(/^-\s*(['"]?)(.+?)\1\s*$/);
      if (item && item[2] !== undefined) {
        categories = toSemanticCategories([...(categories ?? []), item[2]]);
        continue;
      }
      inCategoryList = false;
    }
  }
  if (!seenBlock.value) return DEFAULT_JUDGE_PRIMARY;
  return { enabled, block, categories: categories ?? DEFAULT_JUDGE_PRIMARY.categories };
}

function toSemanticCategories(raw: readonly string[]): SemanticCheatCategory[] {
  const out: SemanticCheatCategory[] = [];
  for (const r of raw) {
    const v = r.trim().replace(/^['"]|['"]$/g, '');
    if (v === 'goal-not-fixed' || v === 'cheat-mock-mutation') {
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

// Surface a typo or indentation slip in `.swarm/audit-config.yaml`
// instead of silently returning the default. Without this, the user
// edits the file, the parser fails to recognize anything, and the
// audit runs as if the file weren't there — the worst kind of silent
// failure for a config that exists to suppress findings.
function warnIfUnrecognized(
  file: string,
  text: string,
  excludePaths: readonly string[],
): void {
  if (excludePaths.length > 0) return;
  if (/^\s*intentSeverityPolicy\s*:/m.test(text)) return;
  if (/^\s*judgePrimary\s*:/m.test(text)) return;
  if (/^\s*executionGrounded\s*:/m.test(text)) return;
  const hasContent = text
    .split(/\r?\n/)
    .some((line) => line.replace(/#.*$/, '').trim().length > 0);
  if (!hasContent) return;
  getLogger('audit-config').warn(
    `audit-config: ${file} has content but no recognized fields were parsed. ` +
      `Supported keys: excludePaths (list of glob strings), intentSeverityPolicy ` +
      `(strict|lenient|off). See docs/audit-config.md.`,
  );
}

// Parses the optional `intentSeverityPolicy:` scalar. Accepts
// 'strict' | 'lenient' | 'off' (case-insensitive, optional quotes).
// Any other value or absent key falls back to the default 'strict'.
// We do not throw on a bad value here — silently defaulting matches
// the existing excludePaths behavior and keeps a typo from breaking
// the audit run on a repo where the user is just experimenting.
function parseIntentSeverityPolicy(text: string): IntentSeverityPolicy {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = line.match(/^intentSeverityPolicy\s*:\s*(['"]?)([A-Za-z]+)\1\s*$/);
    if (m && m[2] !== undefined) {
      const value = m[2].toLowerCase();
      if (value === 'strict' || value === 'lenient' || value === 'off') {
        return value;
      }
      return DEFAULT_INTENT_POLICY;
    }
  }
  return DEFAULT_INTENT_POLICY;
}

// Hand-rolled tiny YAML scan for the one supported field. Avoids a
// runtime YAML dep on a hot-path for what is effectively a list of
// strings; the project already keeps its YAML loader scoped to
// contract parsing.
function parseExcludePaths(text: string): readonly string[] {
  const lines = text.split(/\r?\n/);
  let inExcludeBlock = false;
  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '');
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (/^excludePaths\s*:/.test(trimmed)) {
      inExcludeBlock = true;
      continue;
    }
    if (inExcludeBlock) {
      const m = trimmed.match(/^-\s*(['"]?)(.+?)\1\s*$/);
      if (m && m[2] !== undefined) {
        out.push(m[2]);
        continue;
      }
      // Any non-list line ends the block.
      if (!trimmed.startsWith('-')) inExcludeBlock = false;
    }
  }
  return out;
}

export function buildExcludeMatcher(
  patterns: readonly string[],
): (filePath: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map(globToRegex);
  return (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/');
    return regexes.some((re) => re.test(normalized));
  };
}

function globToRegex(glob: string): RegExp {
  let i = 0;
  let pattern = '';
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      // `**/` matches zero or more path segments
      if (glob[i + 2] === '/') {
        pattern += '(?:.*/)?';
        i += 3;
      } else {
        pattern += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      pattern += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      pattern += '[^/]';
      i += 1;
    } else if (ch !== undefined && /[.+^$()|{}\[\]\\]/.test(ch)) {
      pattern += `\\${ch}`;
      i += 1;
    } else {
      pattern += ch ?? '';
      i += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}
