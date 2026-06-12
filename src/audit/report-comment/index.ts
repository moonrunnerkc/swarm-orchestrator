// Renders an audit result as a GitHub PR-comment body. Output is
// deterministic for a given input; the timestamp and ledger link are
// the only run-specific fields.
//
// v10.2-advisory additions:
//   - Per-finding measured-precision badge under each finding header,
//     pulled from `./detector-precision.ts`. Lets a reviewer see the
//     measured precision number every time a finding fires.
//   - Audit-mode banner. In `advise` (the default) the PR comment makes
//     it explicit that the audit is reporting suspicions, not gating
//     the merge. In `gate` the comment matches the v10.1 contract.

import type { AuditMode, AuditResult, Finding, RuntimeCorroboration, Severity } from '../types';
import { isExecutionGroundedCategory } from '../types';
import { formatPrecisionBadge } from './detector-precision';
import { renderBlockTriggerSection } from './block-trigger-section';
import type { BlockTrigger } from '../gate/block-trigger-types';

export interface RenderOptions {
  ledgerUrl?: string;
  aibomUrl?: string;
  leaderboardUrl?: string;
  /**
   * Mode the audit ran in. Defaults to `gate` to preserve the v10.1
   * rendered shape for callers that have not been updated. New
   * callers should pass the value explicitly so the comment makes the
   * suspicion-score vs. merge-gate distinction visible to the
   * reviewer.
   */
  mode?: AuditMode;
  /**
   * Block-eligible triggers that fired on this PR (the verifiable-evidence
   * gate). Rendered with their reproduce command and evidence so a blocked
   * author can re-run the proof. Absent or empty renders nothing.
   */
  blockTriggers?: BlockTrigger[];
}

const SEVERITY_ORDER: Severity[] = ['block', 'warn', 'info'];

export function renderPrComment(result: AuditResult, options: RenderOptions = {}): string {
  const mode: AuditMode = options.mode ?? 'gate';
  const headline = renderHeadline(result, mode);
  const subtitle = renderSubtitle(result, mode);

  const lines: string[] = [headline, '', subtitle, ''];

  const modeBanner = renderModeBanner(mode);
  if (modeBanner !== undefined) {
    lines.push(modeBanner, '');
  }

  const agentLine = renderAgentLine(result);
  if (agentLine !== undefined) {
    lines.push(agentLine, '');
  }

  const intentLine = renderIntentNote(result);
  if (intentLine !== undefined) {
    lines.push(intentLine, '');
  }

  lines.push(renderSummary(result), '');

  for (const line of renderBlockTriggerSection(options.blockTriggers ?? [], mode)) {
    lines.push(line);
  }

  for (const severity of SEVERITY_ORDER) {
    const bucket = result.findings.filter((f) => f.severity === severity);
    if (bucket.length === 0) continue;
    lines.push(renderSeverityHeader(severity, bucket.length, mode));
    lines.push('');
    for (const line of renderBucketWithCascadeCap(bucket)) {
      lines.push(line);
    }
  }

  lines.push(renderFooter(result, options));
  return lines.join('\n').trimEnd() + '\n';
}

function renderHeadline(result: AuditResult, mode: AuditMode): string {
  if (mode === 'advise') {
    return result.findings.length === 0
      ? '# Swarm Audit: ADVISORY — clean'
      : '# Swarm Audit: ADVISORY';
  }
  return result.pass ? '# Swarm Audit: PASS' : '# Swarm Audit: BLOCK';
}

function renderSubtitle(result: AuditResult, mode: AuditMode): string {
  if (mode === 'advise') {
    if (result.findings.length === 0) {
      return '_No suspicion-score signal raised on this PR. Advisory mode — not a merge gate._';
    }
    return '_Suspicion-score signal raised below for human review. Advisory mode — not a merge gate._';
  }
  return result.pass
    ? '_No blocking cheat patterns detected. Audit obligations are satisfied._'
    : '_Blocking findings below must be addressed before this PR can be merged._';
}

function renderModeBanner(mode: AuditMode): string | undefined {
  if (mode === 'advise') {
    return (
      '> **Advisory mode (`--mode=advise`).** Findings below are signals for a ' +
      'human reviewer, not gating verdicts. Merging is not blocked. ' +
      'Switch to `--mode=gate` to make the audit refuse a merge on blocking findings.'
    );
  }
  return (
    '> **Gate mode (`--mode=gate`).** Blocking findings below will fail this ' +
    'check and refuse the merge. Re-run with `--mode=advise` to receive the ' +
    'same signal without blocking.'
  );
}

function renderAgentLine(result: AuditResult): string | undefined {
  if (result.agent === undefined) return undefined;
  const { vendor, version, confidence, source } = result.agent;
  const versionPart = version !== undefined ? ` v${version}` : '';
  return `**Detected agent:** \`${vendor}\`${versionPart} (confidence: ${confidence}, signal: ${source})`;
}

// One-line note printed at the top of the comment when the PR-intent
// layer escalated at least one finding's severity. Quotes the agent's
// fix-claim back so the human reviewer can see why the audit took a
// harder line on this PR than it would have on a neutrally-titled
// change. Returns undefined when no finding was upgraded; silence when
// nothing changed.
function renderIntentNote(result: AuditResult): string | undefined {
  const upgraded = result.findings.filter((f) => f.intentUpgraded === true);
  if (upgraded.length === 0) return undefined;
  const categories = Array.from(new Set(upgraded.map((f) => f.category)));
  const catList = categories.map((c) => `\`${c}\``).join(', ');
  return (
    `**Severity raised by PR-intent layer:** ${upgraded.length} finding(s) ` +
    `across ${catList} were escalated because the PR claims a fix. ` +
    `Disable with \`intentSeverityPolicy: off\` in \`.swarm/audit-config.yaml\`.`
  );
}

function renderSummary(result: AuditResult): string {
  const total = result.findings.length;
  const blocking = result.findings.filter((f) => f.severity === 'block').length;
  const warnings = result.findings.filter((f) => f.severity === 'warn').length;
  const detectorList = Object.entries(result.detectorVersions)
    .map(([name, version]) => `\`${name}@${version}\``)
    .join(', ');
  const setLabel = result.detectorSet ?? 'default';
  return [
    `**Findings:** ${total} total — ${blocking} blocking, ${warnings} warnings.`,
    `**Detector set:** \`${setLabel}\``,
    `**Detectors run:** ${detectorList}`,
  ].join('\n');
}

function renderSeverityHeader(severity: Severity, count: number, mode: AuditMode): string {
  const label = severity === 'block' ? 'Blocking' : severity === 'warn' ? 'Warning' : 'Informational';
  if (mode === 'advise' && severity === 'block') {
    return `## Blocking-severity findings (${count}) — advisory only, not gating`;
  }
  return `## ${label} (${count})`;
}

// Cap how many findings of one category render inside a single severity
// bucket. A 300-file docs PR once produced 310 no-op-fix findings of the
// identical shape; rendering them all buries any real signal and floods
// the PR. Beyond the cap, one summary line reports the remainder so the
// suppression is visible rather than silent.
const MAX_FINDINGS_PER_CATEGORY = 10;

function renderBucketWithCascadeCap(bucket: readonly Finding[]): string[] {
  const shownByCategory = new Map<string, number>();
  const omittedByCategory = new Map<string, number>();
  const out: string[] = [];
  for (const finding of bucket) {
    const shown = shownByCategory.get(finding.category) ?? 0;
    if (shown >= MAX_FINDINGS_PER_CATEGORY) {
      omittedByCategory.set(finding.category, (omittedByCategory.get(finding.category) ?? 0) + 1);
      continue;
    }
    shownByCategory.set(finding.category, shown + 1);
    out.push(renderFinding(finding));
    out.push('');
  }
  for (const [category, omitted] of omittedByCategory) {
    out.push(
      `> ${omitted} more \`${category}\` finding(s) of the same shape were ` +
        `collapsed to keep this comment readable (showing the first ` +
        `${MAX_FINDINGS_PER_CATEGORY}). See the evidence ledger for the full list.`,
    );
    out.push('');
  }
  return out;
}

/** One-line description of the execution signal backing a runtime-corroborated
 *  finding, shown under the confidence line so the grade is auditable. */
function formatCorroboration(rc: RuntimeCorroboration): string {
  switch (rc.signal) {
    case 'surviving-mutant':
      return `a surviving mutant (${(rc.mutants ?? []).join('; ')})`;
    case 'coverage-gap':
      return `an uncovered changed line (${(rc.uncoveredLines ?? []).join(', ')})`;
    case 'repro-still-fails':
      return `a still-failing issue repro (${rc.repro ?? ''})`;
    case 'restored-test-fails':
      return `a restored original test that fails on the PR's source (${(rc.failingTests ?? []).join('; ')})`;
    case 'type-error-surfaces':
      return `a tsc diagnostic that surfaces once the added suppression is reverted (${(rc.diagnostics ?? []).join('; ')})`;
    case 'dangling-reference':
      return `a renamed-away symbol still referenced in the checkout (${(rc.references ?? []).join(', ')})`;
    case 'dead-branch-unreached':
      return `an inserted branch the affected tests reached but never entered (${(rc.reachedByTests ?? []).join(', ')})`;
  }
}

function renderFinding(finding: Finding): string {
  const fileLine = finding.location.endLine !== undefined
    ? `\`${finding.location.file}\`:${finding.location.line}-${finding.location.endLine}`
    : `\`${finding.location.file}\`:${finding.location.line}`;
  const badge = formatPrecisionBadge(finding.category);
  const confidence = finding.confidence ?? 'structural-only';
  const lines: string[] = [
    `### \`${finding.category}\` — ${fileLine}`,
    '',
    `*Confidence:* ${confidence}. *Detector precision badge:* ${badge}.`,
    '',
  ];
  if (finding.runtimeCorroboration !== undefined) {
    lines.push(`*Runtime-corroborated by* ${formatCorroboration(finding.runtimeCorroboration)}.`, '');
  }
  lines.push(finding.message, '');
  if (finding.judgeReasoning !== undefined && finding.judgeModelId !== undefined) {
    const promptPart = finding.judgePromptHash !== undefined ? `, prompt \`${finding.judgePromptHash}\`` : '';
    lines.push(
      `*LLM judge (\`${finding.judgeModelId}\`${promptPart}):* ${finding.judgeReasoning}`,
      '',
    );
  }
  // Structural findings carry a diff snippet as evidence; execution-grounded
  // findings (mutation, repro, coverage) carry a run record or captured
  // output, which is not a diff, so it renders in a plain fence.
  const fence = isExecutionGroundedCategory(finding.category) ? '```text' : '```diff';
  lines.push(fence, finding.evidence, '```');
  return lines.join('\n');
}

function renderFooter(result: AuditResult, options: RenderOptions): string {
  const parts: string[] = ['---'];
  const links: string[] = [];
  if (options.ledgerUrl !== undefined) {
    links.push(`[Full evidence ledger](${options.ledgerUrl})`);
  }
  if (options.aibomUrl !== undefined) {
    links.push(`[AI-BOM artifact](${options.aibomUrl})`);
  }
  if (options.leaderboardUrl !== undefined) {
    links.push(`[Agent leaderboard](${options.leaderboardUrl})`);
  }
  if (links.length > 0) parts.push(links.join(' · '));
  parts.push(`_Generated ${result.generatedAt} by [swarm-audit](https://github.com/moonrunnerkc/swarm-orchestrator)._`);
  return parts.join('\n\n');
}
