import { RunReport } from './report-generator';
import type { Finding } from './types/finding';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatFindingLocation(finding: Finding): string {
  if (finding.scope === 'line') return `${finding.filePath}:${finding.line}`;
  if (finding.scope === 'file') return finding.filePath;
  return 'summary';
}

function batteryFindingCounts(findings: Finding[]): string {
  const high = findings.filter(finding => finding.severity === 'high').length;
  const medium = findings.filter(finding => finding.severity === 'medium').length;
  const low = findings.filter(finding => finding.severity === 'low').length;
  return `Findings: ${high} high, ${medium} medium, ${low} low`;
}

export class ReportRenderer {
  static toMarkdown(report: RunReport): string {
    const lines: string[] = [
      '# Swarm Orchestrator Run Report',
      '',
      `**Run:** ${report.executionId}`,
      `**Goal:** ${report.goal}`,
      `**Tool:** ${report.tool} | **Model:** ${report.model}`,
      `**Duration:** ${formatDuration(report.durationMs)}`,
      `**Date:** ${report.startedAt}`,
      '',
      '## Results',
      '',
      `Steps: ${report.results.attempted} attempted, ${report.results.passed} passed, ${report.results.failed} failed, ${report.results.repaired} repaired`,
      `Waves: ${report.waves.count} waves`,
      '',
      '## Per-Step Detail',
      '',
      '| Step | Agent | Task | Status | Checks Passed | Repairs | Cost (est/actual) |',
      '|------|-------|------|--------|---------------|---------|-------------------|'
    ];

    for (const step of report.steps) {
      const checks = step.checksPassed.length > 0 ? step.checksPassed.join(', ') : 'none';
      const costStr = step.estimatedCost !== null && step.actualCost !== null
        ? `${step.estimatedCost} / ${step.actualCost}`
        : 'n/a';
      lines.push(`| ${step.stepNumber} | ${step.agentName} | ${step.task} | ${step.verificationStatus} | ${checks} | ${step.repairAttempts} | ${costStr} |`);
    }

    lines.push('');

    if (report.cost) {
      const accuracyPct = (report.cost.accuracy * 100).toFixed(1);
      lines.push('## Cost Attribution');
      lines.push('');
      lines.push(`Estimated: ${report.cost.estimatedPremiumRequests} premium requests | Actual: ${report.cost.actualPremiumRequests} | Accuracy: ${accuracyPct}%`);
      lines.push(`Model: ${report.model} (${report.cost.modelMultiplier}x multiplier)`);
      lines.push(`Overage: ${report.cost.overageTriggered ? 'yes' : 'no'}`);
      lines.push('');
    }

    lines.push('## Verification Evidence');
    lines.push('');
    lines.push(`Git diffs: ${report.verification.totalGitDiffs} | Build passes: ${report.verification.buildPasses} | Test passes: ${report.verification.testPasses} | Transcript matches: ${report.verification.transcriptMatches}`);
    lines.push('');

    if (report.falsificationBattery) {
      const battery = report.falsificationBattery;
      const layers = battery.layerResults ?? battery.layers ?? [];
      const findings = battery.findings ?? [];
      lines.push('## Falsification Battery');
      lines.push('');
      lines.push(`Composite score: ${battery.compositeScore}`);
      if (battery.hardGatePassed !== undefined) {
        lines.push(`Hard gates: ${battery.hardGatePassed ? 'passed' : 'failed'}`);
      }
      lines.push(`Human review: ${battery.humanReviewRequired ? 'yes' : 'no'}`);
      if (battery.wallClock !== undefined) lines.push(`Wall clock: ${formatDuration(battery.wallClock)}`);
      if (battery.failedLayers && battery.failedLayers.length > 0) {
        lines.push(`Failed layers: ${battery.failedLayers.join(', ')}`);
      }
      lines.push(batteryFindingCounts(findings));
      for (const layer of layers) {
        lines.push(`- ${layer.layer}: ${layer.status} (${layer.durationMs}ms) ${layer.evidenceSummary}`);
      }
      if (findings.length > 0) {
        lines.push('');
        lines.push('| Severity | Rule | Location | Message |');
        lines.push('|----------|------|----------|---------|');
        for (const finding of findings) {
          lines.push(`| ${finding.severity} | ${finding.ruleId} | ${formatFindingLocation(finding)} | ${finding.message} |`);
        }
      }
      lines.push('');
    }

    if (report.owaspSummary) {
      lines.push('## OWASP Compliance');
      lines.push('');
      lines.push(`Applicable risks: ${report.owaspSummary.applicableRisks}/10 | Mitigated: ${report.owaspSummary.mitigatedRisks} | Partial: ${report.owaspSummary.partialRisks}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  static toJson(report: RunReport): string {
    return JSON.stringify(report, null, 2);
  }

  static toSummaryLine(report: RunReport): string {
    const parts: string[] = [
      `Run ${report.executionId}:`,
      `${report.results.passed}/${report.results.attempted} steps passed`,
      `| ${report.waves.count} waves`
    ];

    if (report.cost) {
      parts.push(`| ${report.cost.actualPremiumRequests} premium requests (est ${report.cost.estimatedPremiumRequests})`);
    }

    if (report.owaspSummary) {
      parts.push(`| OWASP ${report.owaspSummary.mitigatedRisks}/${report.owaspSummary.applicableRisks} mitigated`);
    }

    return parts.join(' ');
  }
}
