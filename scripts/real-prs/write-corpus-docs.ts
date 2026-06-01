// Render the two human-readable corpus docs from committed data:
// repo-selection.md (the ten-plus repo set, the swaps and why) and
// coverage.md (the regression corpus's per-repo and per-category
// distribution). Both are derived, so they never drift from sources.json.
//
// Usage:
//   node dist/scripts/real-prs/write-corpus-docs.js

import * as fs from 'fs';
import { getLogger } from '../../src/logger';
import { ALL_REPOS } from './lib/repos';
import { regressionCoverageFile, regressionSourcesFile, repoSelectionFile } from './lib/paths';
import type { RegressionCategory, RegressionSourcesFile } from './lib/types';

const log = getLogger('real-prs:corpus-docs');

function renderRepoSelection(reg: RegressionSourcesFile | null): string {
  const lines: string[] = [];
  lines.push('# Repo selection for the v11 benefit evaluation');
  lines.push('');
  lines.push(
    'The corpus spans the pilot\'s five repos plus added active TypeScript / JavaScript repos with rich PR ' +
      'history and visible revert / fix patterns. Repos that yielded no usable retrospective-bad signal were ' +
      'swapped for an active substitute rather than padded.',
  );
  lines.push('');
  lines.push('| repo | role | rationale |');
  lines.push('|---|---|---|');
  for (const r of ALL_REPOS) {
    const role = r.substitutedFor ? `substitute for ${r.substitutedFor}` : 'pilot or added';
    lines.push(`| ${r.slug} | ${role} | ${r.rationale} |`);
  }
  lines.push('');
  lines.push('## Swaps');
  lines.push('');
  const swaps = ALL_REPOS.filter((r) => r.substitutedFor !== undefined);
  if (swaps.length === 0) lines.push('_None._');
  else {
    for (const r of swaps) {
      lines.push(
        `- **${r.substitutedFor} -> ${r.slug}.** ${r.substitutedFor} produced zero retrospective-bad ` +
          'signals in the search window (the project is in maintenance), so it was replaced by an active repo.',
      );
    }
  }
  lines.push('');
  if (reg !== null && reg.shortRepos.length > 0) {
    lines.push('## Repos below the per-repo floor');
    lines.push('');
    lines.push(
      'These repos are genuine but low-revert-velocity; their retrospective-bad count after widening the ' +
        'window to 24 months is below the soft floor of 3. They are kept (not padded) and disclosed here.',
    );
    lines.push('');
    lines.push('| repo | bad PRs found | note |');
    lines.push('|---|---|---|');
    for (const s of reg.shortRepos) lines.push(`| ${s.repo} | ${s.found} | ${s.reason} |`);
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

function renderCoverage(reg: RegressionSourcesFile): string {
  const byRepo = new Map<string, number>();
  const byCategory = new Map<RegressionCategory, number>();
  const byProof = new Map<string, number>();
  for (const p of reg.prs) {
    byRepo.set(p.repo, (byRepo.get(p.repo) ?? 0) + 1);
    byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
    for (const proof of p.proofs) byProof.set(proof.kind, (byProof.get(proof.kind) ?? 0) + 1);
  }
  const lines: string[] = [];
  lines.push('# Regression corpus coverage');
  lines.push('');
  lines.push(
    `${reg.prs.length} retrospectively-bad merged PRs across ${reg.repos.length} repos, each with at least ` +
      'one proof (a revert, a fix-PR, a hotfix, or a maintainer-confirmed issue) that the PR was wrong. ' +
      `Fetched ${reg.fetchedAt}; base search window ${reg.windowMonths} months (widened to 24 for thin repos).`,
  );
  lines.push('');
  lines.push('## By repo');
  lines.push('');
  lines.push('| repo | bad PRs |');
  lines.push('|---|---|');
  for (const [repo, n] of [...byRepo.entries()].sort()) lines.push(`| ${repo} | ${n} |`);
  lines.push('');
  lines.push('## By cheat-relevant category');
  lines.push('');
  lines.push('| category | bad PRs |');
  lines.push('|---|---|');
  for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${cat} | ${n} |`);
  lines.push('');
  lines.push('## By proof kind');
  lines.push('');
  lines.push('| proof | count |');
  lines.push('|---|---|');
  for (const [kind, n] of [...byProof.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${kind} | ${n} |`);
  lines.push('');
  return lines.join('\n') + '\n';
}

function main(): void {
  const reg = fs.existsSync(regressionSourcesFile())
    ? (JSON.parse(fs.readFileSync(regressionSourcesFile(), 'utf8')) as RegressionSourcesFile)
    : null;
  fs.writeFileSync(repoSelectionFile(), renderRepoSelection(reg));
  if (reg !== null) fs.writeFileSync(regressionCoverageFile(), renderCoverage(reg));
  log.info('wrote repo-selection.md and coverage.md');
}

main();
