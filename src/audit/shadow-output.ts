// Single-file shadow-mode output. v10.3 adds `--shadow-output <path>`
// alongside the existing `--shadow <repo-label>`; the per-repo
// directory layout is left in place for the multi-PR rollup use
// case, while the single-file form is what users want when piping a
// shadow run into a downstream report.
//
// Schema (one JSON object per audited PR):
//
//   {
//     prRef,                           // e.g. "octocat/spoon-knife#42" or null when --diff-file
//     auditedAt,                       // ISO timestamp at write time
//     durationMs,                      // wall-clock of the audit run
//     detectorVerdicts: [              // one entry per loaded detector
//       { detector, version, fired, severity }
//     ],
//     judgeInvocations: number,        // count of llm-judge-result ledger entries
//     renderedComment: string          // the PR-comment body the gate-mode path would post
//   }

import * as fs from 'fs';
import * as path from 'path';
import type { AuditMode, AuditResult, Finding, Severity } from './types';
import { renderPrComment } from './report-comment';
import { readEntries } from '../ledger/ledger';

export interface ShadowOutputDetectorVerdict {
  detector: string;
  version: string;
  fired: boolean;
  severity: Severity | 'none';
}

export interface ShadowOutputEntry {
  schemaVersion: 2;
  prRef: string | null;
  auditedAt: string;
  durationMs: number;
  detectorVerdicts: ShadowOutputDetectorVerdict[];
  judgeInvocations: number;
  renderedComment: string;
}

export interface BuildShadowOutputArgs {
  prRef: string | null;
  durationMs: number;
  result: AuditResult;
  mode: AuditMode;
  ledgerPath: string;
  ledgerUrl?: string;
}

export function buildShadowOutput(args: BuildShadowOutputArgs): ShadowOutputEntry {
  const verdicts: ShadowOutputDetectorVerdict[] = Object.entries(
    args.result.detectorVersions,
  )
    .map(([detector, version]) => {
      const matched = args.result.findings.filter((f) => f.category === detector);
      const fired = matched.length > 0;
      const severity: ShadowOutputDetectorVerdict['severity'] = fired
        ? worstSeverity(matched)
        : 'none';
      return { detector, version, fired, severity };
    })
    .sort((a, b) => a.detector.localeCompare(b.detector));

  const judgeInvocations = countJudgeInvocations(args.ledgerPath);

  const renderOptions: { mode: AuditMode; ledgerUrl?: string } = { mode: args.mode };
  if (args.ledgerUrl !== undefined) renderOptions.ledgerUrl = args.ledgerUrl;
  const renderedComment = renderPrComment(args.result, renderOptions);

  return {
    schemaVersion: 2,
    prRef: args.prRef,
    auditedAt: new Date().toISOString(),
    durationMs: args.durationMs,
    detectorVerdicts: verdicts,
    judgeInvocations,
    renderedComment,
  };
}

export function writeShadowOutputFile(
  outPath: string,
  entry: ShadowOutputEntry,
): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(entry, null, 2) + '\n');
}

function worstSeverity(findings: Finding[]): Severity {
  let worst: Severity = 'info';
  for (const f of findings) {
    if (f.severity === 'block') return 'block';
    if (f.severity === 'warn') worst = 'warn';
  }
  return worst;
}

function countJudgeInvocations(ledgerPath: string): number {
  if (!fs.existsSync(ledgerPath)) return 0;
  const entries = readEntries(ledgerPath);
  return entries.filter((e) => e.type === 'llm-judge-result').length;
}
