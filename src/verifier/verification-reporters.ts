import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../logger';
import type { VerificationResult } from '../verifier-engine';

async function runGitCommand(workingDir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: workingDir });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Git command failed with code ${code}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

/**
 * Render a VerificationResult as a Markdown report and persist it.
 */
export async function generateVerificationReport(
  result: VerificationResult,
  outputPath: string,
): Promise<void> {
  const lines: string[] = [];

  lines.push('# Verification Report');
  lines.push('');
  lines.push(`**Step**: ${result.stepNumber}`);
  lines.push(`**Agent**: ${result.agentName}`);
  lines.push(`**Status**: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
  lines.push(`**Timestamp**: ${result.timestamp}`);
  lines.push(`**Transcript**: ${result.transcriptPath}`);
  lines.push('');

  lines.push('## Verification Checks');
  lines.push('');

  result.checks.forEach((check) => {
    const icon = check.passed ? '✅' : '❌';
    const req = check.required ? '(required)' : '(optional)';
    lines.push(`### ${icon} ${check.description} ${req}`);
    lines.push('');
    lines.push(`**Type**: ${check.type}`);
    lines.push(`**Passed**: ${check.passed}`);

    if (check.evidence) lines.push(`**Evidence**: ${check.evidence}`);
    if (check.reason) lines.push(`**Reason**: ${check.reason}`);

    lines.push('');
  });

  if (result.unverifiedClaims.length > 0) {
    lines.push('## ⚠️ Unverified Claims (Drift Detection)');
    lines.push('');
    lines.push('The following claims were made without supporting evidence:');
    lines.push('');
    result.unverifiedClaims.forEach((claim) => {
      lines.push(`- ${claim}`);
    });
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  const passedCount = result.checks.filter((c) => c.passed).length;
  const totalCount = result.checks.length;
  lines.push(`**Checks Passed**: ${passedCount}/${totalCount}`);
  lines.push(`**Unverified Claims**: ${result.unverifiedClaims.length}`);
  lines.push('');

  if (!result.passed) {
    lines.push(
      '**Action Required**: This step failed verification. Review the issues above and retry.',
    );
  } else {
    lines.push('**Result**: All required checks passed. Step verified successfully.');
  }

  const reportContent = lines.join('\n');

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, reportContent, 'utf8');
}

/**
 * Commit the verification report with a natural-language message.
 * Skips silently when the report lives outside the target worktree
 * (e.g. bootstrap mode writing into the orchestrator's own runs/).
 */
export async function commitVerificationReport(
  reportPath: string,
  workingDir: string,
  stepNumber: number,
  agentName: string,
  passed: boolean,
  logger: Logger,
): Promise<void> {
  const status = passed ? 'verified' : 'failed verification';
  const messages = [
    `verify step ${stepNumber} (${agentName}) - ${status}`,
    `add verification report for step ${stepNumber}`,
    `verification: step ${stepNumber} ${status}`,
    `step ${stepNumber} verification ${passed ? 'passed' : 'failed'}`,
  ];
  const message = messages[Math.floor(Math.random() * messages.length)];

  const resolvedReport = path.resolve(reportPath);
  const resolvedWorkDir = path.resolve(workingDir);
  if (!resolvedReport.startsWith(resolvedWorkDir + path.sep)) {
    return;
  }

  try {
    await runGitCommand(workingDir, ['add', '-f', reportPath]);
    await runGitCommand(workingDir, ['commit', '-m', message]);
  } catch (err: unknown) {
    const error = err as Error;
    if (!error.message.includes('nothing to commit')) {
      logger.warn(`  ⚠️  Could not commit verification report: ${error.message.split('\n')[0]}`);
    }
  }
}
