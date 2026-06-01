// Compute the Venn analysis between this auditor and the external tools.
// For each PR: findings only the auditor caught, findings only the
// external tools caught, and findings both caught (a code location flagged
// by both). The "only auditor" set on the regression corpus, where every
// PR is independently labeled bad by an attached revert or fix-PR, is the
// candidate class this tool uniquely catches. A finding counts as caught
// by both when an external finding lands on the same file within a few
// lines of the auditor finding's range; category names are not required
// to match, since the question is only whether any other tool flagged the
// same code.
//
// Usage:
//   node dist/scripts/real-prs/differential-venn.js

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { splitFindings } from './lib/benefit';
import {
  auditResultsV2Dir,
  differentialDir,
  realPrsDir,
  regressionAuditResultsDir,
  regressionSourcesFile,
  repoSlug,
  sourcesV2File,
  vennJsonFile,
  vennMdFile,
} from './lib/paths';
import type {
  AuditResultRecord,
  DifferentialFinding,
  HarnessFinding,
  RegressionSourcesFile,
  SourcesFile,
  VennPr,
  VennSummary,
} from './lib/types';

const log = getLogger('real-prs:venn');

type Corpus = 'regression' | 'clean';

function auditDir(corpus: Corpus): string {
  return corpus === 'regression' ? regressionAuditResultsDir() : auditResultsV2Dir();
}

function diffOutDir(corpus: Corpus): string {
  return corpus === 'regression' ? differentialDir() : path.join(realPrsDir(), 'differential-v2');
}

const TOOLS = ['semgrep', 'eslint-security'];

function loadAuditRecord(corpus: Corpus, repo: string, pr: number): AuditResultRecord | null {
  const file = path.join(auditDir(corpus), repoSlug(repo), `${pr}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as AuditResultRecord;
}

function loadExternal(corpus: Corpus, repo: string, pr: number): DifferentialFinding[] {
  const out: DifferentialFinding[] = [];
  for (const tool of TOOLS) {
    const file = path.join(diffOutDir(corpus), tool, repoSlug(repo), `${pr}.json`);
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { findings?: DifferentialFinding[] };
    for (const f of parsed.findings ?? []) out.push(f);
  }
  return out;
}

function vennForPr(
  corpus: Corpus,
  repo: string,
  pr: number,
  post: HarnessFinding[],
  external: DifferentialFinding[],
): VennPr {
  const split = splitFindings(post, external);
  return {
    repo,
    prNumber: pr,
    corpus,
    onlyAuditor: split.onlyAuditorKeys.length,
    onlyExternal: split.onlyExternal,
    both: split.both,
    onlyAuditorKeys: split.onlyAuditorKeys,
  };
}

function collectPrs(corpus: Corpus): Array<{ repo: string; pr: number }> {
  if (corpus === 'regression') {
    if (!fs.existsSync(regressionSourcesFile())) return [];
    const s = JSON.parse(fs.readFileSync(regressionSourcesFile(), 'utf8')) as RegressionSourcesFile;
    return s.prs.map((p) => ({ repo: p.repo, pr: p.prNumber }));
  }
  if (!fs.existsSync(sourcesV2File())) return [];
  const s = JSON.parse(fs.readFileSync(sourcesV2File(), 'utf8')) as SourcesFile;
  return s.prs.map((p) => ({ repo: p.repo, pr: p.prNumber }));
}

function renderMd(summary: VennSummary): string {
  const lines: string[] = [];
  lines.push('# Differential Venn: this auditor vs Semgrep + ESLint security rules');
  lines.push('');
  lines.push(
    `Tools: ${summary.tools.join(', ')}. Generated ${summary.generatedAt}. A finding is "both" when ` +
      'an external tool flagged the same file within a few lines of the auditor finding; "only auditor" ' +
      'is an auditor finding no external tool flagged at that location. On the regression corpus every PR ' +
      'is independently labeled bad by an attached revert or fix-PR, so the "only auditor" set there is the ' +
      'candidate class this tool uniquely catches.',
  );
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push('| corpus | only auditor | only external | both |');
  lines.push('|---|---|---|---|');
  for (const c of summary.perCorpus) {
    lines.push(`| ${c.corpus} | ${c.onlyAuditor} | ${c.onlyExternal} | ${c.both} |`);
  }
  lines.push('');
  lines.push('## Regression corpus: the only-auditor findings (candidate unique class)');
  lines.push('');
  const regOnly = summary.prs.filter((p) => p.corpus === 'regression' && p.onlyAuditor > 0);
  if (regOnly.length === 0) {
    lines.push('_Empty: no auditor finding on a retrospectively-bad PR survived the differential. See REDUNDANCY-FINDING.md._');
  } else {
    lines.push('| repo | PR | only-auditor findings | keys |');
    lines.push('|---|---|---|---|');
    for (const p of regOnly) {
      lines.push(`| ${p.repo} | #${p.prNumber} | ${p.onlyAuditor} | ${p.onlyAuditorKeys.join('<br>')} |`);
    }
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

function main(): void {
  const prs: VennPr[] = [];
  for (const corpus of ['regression', 'clean'] as Corpus[]) {
    for (const { repo, pr } of collectPrs(corpus)) {
      const rec = loadAuditRecord(corpus, repo, pr);
      if (rec === null) continue;
      const external = loadExternal(corpus, repo, pr);
      prs.push(vennForPr(corpus, repo, pr, rec.post, external));
    }
  }

  const perCorpus = (['regression', 'clean'] as Corpus[]).map((corpus) => {
    const rows = prs.filter((p) => p.corpus === corpus);
    return {
      corpus,
      onlyAuditor: rows.reduce((n, r) => n + r.onlyAuditor, 0),
      onlyExternal: rows.reduce((n, r) => n + r.onlyExternal, 0),
      both: rows.reduce((n, r) => n + r.both, 0),
    };
  });

  const summary: VennSummary = {
    generatedAt: new Date().toISOString(),
    tools: TOOLS,
    perCorpus,
    prs,
  };
  fs.mkdirSync(path.dirname(vennJsonFile()), { recursive: true });
  fs.writeFileSync(vennJsonFile(), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(vennMdFile(), renderMd(summary));
  const reg = perCorpus.find((c) => c.corpus === 'regression');
  log.info(
    `venn written: regression only-auditor=${reg?.onlyAuditor ?? 0} only-external=${reg?.onlyExternal ?? 0} both=${reg?.both ?? 0}`,
  );
}

main();
