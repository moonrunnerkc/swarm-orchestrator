// Renders an audit result as a GitHub PR-comment body. Output is
// deterministic for a given input; the timestamp and ledger link are
// the only run-specific fields.

import type { AuditResult, Finding, Severity } from '../types';

export interface RenderOptions {
  ledgerUrl?: string;
  aibomUrl?: string;
  leaderboardUrl?: string;
}

const SEVERITY_ORDER: Severity[] = ['block', 'warn', 'info'];

export function renderPrComment(result: AuditResult, options: RenderOptions = {}): string {
  const headline = result.pass
    ? '# Swarm Audit: PASS'
    : '# Swarm Audit: BLOCK';
  const subtitle = result.pass
    ? '_No blocking cheat patterns detected. Audit obligations are satisfied._'
    : '_Blocking findings below must be addressed before this PR can be merged._';

  const lines: string[] = [headline, '', subtitle, ''];

  const agentLine = renderAgentLine(result);
  if (agentLine !== undefined) {
    lines.push(agentLine, '');
  }

  const intentLine = renderIntentNote(result);
  if (intentLine !== undefined) {
    lines.push(intentLine, '');
  }

  lines.push(renderSummary(result), '');

  for (const severity of SEVERITY_ORDER) {
    const bucket = result.findings.filter((f) => f.severity === severity);
    if (bucket.length === 0) continue;
    lines.push(renderSeverityHeader(severity, bucket.length));
    lines.push('');
    for (const finding of bucket) {
      lines.push(renderFinding(finding));
      lines.push('');
    }
  }

  lines.push(renderFooter(result, options));
  return lines.join('\n').trimEnd() + '\n';
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
  return [
    `**Findings:** ${total} total — ${blocking} blocking, ${warnings} warnings.`,
    `**Detectors run:** ${detectorList}`,
  ].join('\n');
}

function renderSeverityHeader(severity: Severity, count: number): string {
  const label = severity === 'block' ? 'Blocking' : severity === 'warn' ? 'Warning' : 'Informational';
  return `## ${label} (${count})`;
}

function renderFinding(finding: Finding): string {
  const fileLine = finding.location.endLine !== undefined
    ? `\`${finding.location.file}\`:${finding.location.line}-${finding.location.endLine}`
    : `\`${finding.location.file}\`:${finding.location.line}`;
  return [
    `### \`${finding.category}\` — ${fileLine}`,
    '',
    finding.message,
    '',
    '```diff',
    finding.evidence,
    '```',
  ].join('\n');
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
