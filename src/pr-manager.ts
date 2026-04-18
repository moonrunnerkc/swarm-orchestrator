import { execSync } from 'child_process';
import { VerificationResult } from './verifier-engine';
import { StepCostRecord } from './metrics-types';
import { GateResult } from './quality-gates';
import {
  DEFAULT_CONTEXT_LOCK_WAIT_MS,
  DEFAULT_BRANCH_SWITCH_TIMEOUT_MS,
} from './defaults';

/**
 * PR merge mode controls the merge phase behavior.
 * 'auto' creates a PR with evidence, auto-merges when checks pass.
 * 'review' creates a PR with evidence, pauses until human approval.
 */
export type PRMode = 'auto' | 'review';

export interface PRCreateResult {
  success: boolean;
  url?: string;
  number?: number;
  error?: string;
}

export interface PRStatusResult {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  approved: boolean;
  reviewDecision?: string;
  mergeable?: string;
}

/**
 * Format options for composing PR evidence comments.
 */
export interface PRCommentContent {
  verification?: VerificationResult | undefined;
  costRecord?: StepCostRecord | undefined;
  gateResults?: GateResult[] | undefined;
}

/**
 * Per-step PR lifecycle management.
 *
 * Creates PRs for verified step branches, attaches verification evidence
 * and cost attribution as comments, and handles auto-merge or review-wait
 * depending on the configured mode.
 */
export class PRManager {
  private workingDir: string;
  private ghAvailable: boolean | null = null;

  constructor(workingDir?: string) {
    this.workingDir = workingDir || process.cwd();
  }

  /**
   * Check whether the gh CLI is installed and authenticated.
   * Caches the result for the lifetime of this instance.
   */
  isGhAvailable(): boolean {
    if (this.ghAvailable !== null) return this.ghAvailable;

    try {
      execSync('gh auth status', {
        cwd: this.workingDir,
        stdio: 'pipe',
        timeout: DEFAULT_CONTEXT_LOCK_WAIT_MS
      });
      this.ghAvailable = true;
    } catch {
      this.ghAvailable = false;
    }
    return this.ghAvailable;
  }

  /**
   * Create a PR for a step branch with verification evidence attached.
   */
  createStepPR(
    branchName: string,
    baseBranch: string,
    stepNumber: number,
    agentName: string,
    taskDescription: string,
    content: PRCommentContent
  ): PRCreateResult {
    if (!this.isGhAvailable()) {
      return { success: false, error: 'gh CLI not available or not authenticated. Install gh and run "gh auth login" to use --pr mode.' };
    }

    const title = `[Swarm Step ${stepNumber}] ${agentName}: ${this.truncate(taskDescription, 60)}`;
    const body = this.formatPRBody(stepNumber, agentName, taskDescription, content);

    try {
      // Push the branch to remote before creating the PR
      try {
        execSync(`git push -u origin "${branchName}"`, {
          cwd: this.workingDir,
          stdio: 'pipe',
          timeout: DEFAULT_CONTEXT_LOCK_WAIT_MS
        });
      } catch (pushErr: unknown) {
        const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        // If the branch already exists on remote, that's fine
        if (!pushMsg.includes('already exists') && !pushMsg.includes('Everything up-to-date')) {
          return { success: false, error: `Failed to push branch ${branchName}: ${pushMsg}` };
        }
      }

      const output = execSync(
        `gh pr create --base "${baseBranch}" --head "${branchName}" --title "${this.escapeShell(title)}" --body "${this.escapeShell(body)}"`,
        {
          cwd: this.workingDir,
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: DEFAULT_CONTEXT_LOCK_WAIT_MS
        }
      );

      const url = this.extractUrl(output);
      const prNumber = this.extractPRNumber(url || output);

      const result: PRCreateResult = { success: true };
      if (url) result.url = url;
      if (prNumber !== undefined) result.number = prNumber;
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `PR creation failed for ${branchName}: ${msg}` };
    }
  }

  /**
   * Add a cost attribution comment to an existing PR.
   */
  addCostComment(prNumber: number, costRecord: StepCostRecord): boolean {
    const comment = this.formatCostComment(costRecord);
    return this.addComment(prNumber, comment);
  }

  /**
   * Add quality gate results as a comment to an existing PR.
   */
  addGateResultsComment(prNumber: number, gateResults: GateResult[]): boolean {
    const comment = this.formatGateResultsComment(gateResults);
    return this.addComment(prNumber, comment);
  }

  /**
   * Auto-merge a PR if all checks pass, using the merge commit strategy.
   */
  autoMergePR(prNumber: number): boolean {
    try {
      execSync(
        `gh pr merge ${prNumber} --merge --auto`,
        {
          cwd: this.workingDir,
          stdio: 'pipe',
          timeout: DEFAULT_BRANCH_SWITCH_TIMEOUT_MS
        }
      );
      return true;
    } catch {
      // Auto-merge may not be enabled on the repo; fall back to immediate merge
      try {
        execSync(
          `gh pr merge ${prNumber} --merge`,
          {
            cwd: this.workingDir,
            stdio: 'pipe',
            timeout: DEFAULT_BRANCH_SWITCH_TIMEOUT_MS
          }
        );
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Poll PR status until it is approved or merged.
   * Returns once the PR leaves the OPEN+unapproved state.
   * Times out after maxWaitMs (default: 30 minutes).
   */
  async waitForApproval(
    prNumber: number,
    pollIntervalMs: number = DEFAULT_BRANCH_SWITCH_TIMEOUT_MS,
    maxWaitMs: number = 1_800_000
  ): Promise<PRStatusResult> {
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const status = this.getPRStatus(prNumber);

      if (status.state === 'MERGED' || status.state === 'CLOSED') {
        return status;
      }

      if (status.approved) {
        return status;
      }

      await this.sleep(pollIntervalMs);
    }

    return { state: 'OPEN', approved: false, reviewDecision: 'TIMEOUT' };
  }

  /**
   * Get current PR status, review decision, and mergeability.
   */
  getPRStatus(prNumber: number): PRStatusResult {
    try {
      const output = execSync(
        `gh pr view ${prNumber} --json state,reviewDecision,mergeable`,
        {
          cwd: this.workingDir,
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: DEFAULT_CONTEXT_LOCK_WAIT_MS
        }
      );

      const data = JSON.parse(output);
      return {
        state: data.state || 'OPEN',
        approved: data.reviewDecision === 'APPROVED',
        reviewDecision: data.reviewDecision,
        mergeable: data.mergeable
      };
    } catch {
      return { state: 'OPEN', approved: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  /**
   * Compose the PR body with verification evidence.
   */
  formatPRBody(
    stepNumber: number,
    agentName: string,
    taskDescription: string,
    content: PRCommentContent
  ): string {
    const lines: string[] = [];

    lines.push(`## Swarm Step ${stepNumber}: ${agentName}`);
    lines.push('');
    lines.push(`**Task:** ${taskDescription}`);
    lines.push('');

    if (content.verification) {
      lines.push('### Verification');
      lines.push('');
      lines.push(this.formatVerificationEvidence(content.verification));
    }

    if (content.costRecord) {
      lines.push('### Cost Attribution');
      lines.push('');
      lines.push(this.formatCostComment(content.costRecord));
    }

    if (content.gateResults && content.gateResults.length > 0) {
      lines.push('### Quality Gates');
      lines.push('');
      lines.push(this.formatGateResultsComment(content.gateResults));
    }

    lines.push('---');
    lines.push('*Generated by Swarm Orchestrator*');

    return lines.join('\n');
  }

  /**
   * Format a VerificationResult into a markdown evidence summary.
   */
  formatVerificationEvidence(result: VerificationResult): string {
    const lines: string[] = [];
    const icon = result.passed ? '✅' : '❌';

    lines.push(`${icon} **Verification ${result.passed ? 'Passed' : 'Failed'}**`);
    lines.push('');

    if (result.checks.length > 0) {
      lines.push('| Check | Type | Required | Status | Evidence |');
      lines.push('|-------|------|----------|--------|----------|');

      for (const check of result.checks) {
        const statusIcon = check.passed ? '✓' : '✗';
        const evidence = check.evidence ? this.truncate(check.evidence, 80) : (check.reason || '');
        lines.push(`| ${check.description} | ${check.type} | ${check.required ? 'Yes' : 'No'} | ${statusIcon} | ${evidence} |`);
      }
      lines.push('');
    }

    if (result.unverifiedClaims.length > 0) {
      lines.push(`**Unverified claims (${result.unverifiedClaims.length}):**`);
      for (const claim of result.unverifiedClaims) {
        lines.push(`- ${this.truncate(claim, 120)}`);
      }
      lines.push('');
    }

    if (result.gracefulFailure) {
      lines.push(`> **Note:** This step was allowed to continue despite verification failure.`);
      if (result.degradationReason) {
        lines.push(`> Reason: ${result.degradationReason}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format cost attribution for a comment.
   */
  formatCostComment(record: StepCostRecord): string {
    const lines: string[] = [];
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Estimated Premium Requests | ${record.estimatedPremiumRequests} |`);
    lines.push(`| Actual Premium Requests | ${record.actualPremiumRequests} |`);
    lines.push(`| Retry Count | ${record.retryCount} |`);
    lines.push(`| Prompt Tokens | ${record.promptTokens} |`);
    lines.push(`| Fleet Mode | ${record.fleetMode ? 'Yes' : 'No'} |`);
    lines.push(`| Duration | ${(record.durationMs / 1000).toFixed(1)}s |`);
    return lines.join('\n');
  }

  /**
   * Format quality gate results for a PR comment.
   */
  formatGateResultsComment(gateResults: GateResult[]): string {
    const lines: string[] = [];
    const allPassed = gateResults.every(g => g.status !== 'fail');
    const icon = allPassed ? '✅' : '⚠️';

    lines.push(`${icon} **Quality Gates: ${allPassed ? 'All Passed' : 'Issues Found'}**`);
    lines.push('');
    lines.push('| Gate | Status | Issues |');
    lines.push('|------|--------|--------|');

    for (const gate of gateResults) {
      const statusIcon = gate.status === 'pass' ? '✓' : gate.status === 'fail' ? '✗' : '⊘';
      lines.push(`| ${gate.title} | ${statusIcon} ${gate.status} | ${gate.issues.length} |`);
    }

    // Show top issues for failed gates
    const failedGates = gateResults.filter(g => g.status === 'fail');
    if (failedGates.length > 0) {
      lines.push('');
      lines.push('**Issues:**');
      for (const gate of failedGates) {
        const topIssues = gate.issues.slice(0, 5);
        for (const issue of topIssues) {
          const loc = issue.filePath ? `${issue.filePath}${issue.line ? ':' + issue.line : ''}` : '';
          lines.push(`- ${loc ? `\`${loc}\` ` : ''}${issue.message}`);
        }
        if (gate.issues.length > 5) {
          lines.push(`- ... and ${gate.issues.length - 5} more`);
        }
      }
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private addComment(prNumber: number, body: string): boolean {
    try {
      execSync(
        `gh pr comment ${prNumber} --body "${this.escapeShell(body)}"`,
        {
          cwd: this.workingDir,
          stdio: 'pipe',
          timeout: DEFAULT_BRANCH_SWITCH_TIMEOUT_MS
        }
      );
      return true;
    } catch {
      return false;
    }
  }

  private extractUrl(output: string): string | undefined {
    const match = output.match(/(https:\/\/github\.com\/[^\s]+)/);
    return match ? match[1] : undefined;
  }

  private extractPRNumber(text: string): number | undefined {
    const match = text.match(/\/pull\/(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 3) + '...';
  }

  private escapeShell(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default PRManager;
