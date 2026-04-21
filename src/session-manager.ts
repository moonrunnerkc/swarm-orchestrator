import * as fs from 'fs';
import * as path from 'path';
import { ShareParser, ShareIndex } from './share-parser';

export interface StepShare {
  stepNumber: number;
  agentName: string;
  transcriptPath: string;
  index: ShareIndex;
  importedAt: string;
}

export interface RunContext {
  runId: string;
  runDir: string;
  shares: StepShare[];
}

export class SessionManager {
  private runsDir: string;

  constructor(runsDir?: string) {
    this.runsDir = runsDir || path.join(process.cwd(), 'runs');
  }

  /**
   * create a new run directory structure
   */
  createRun(runId: string): string {
    const runDir = path.join(this.runsDir, runId);

    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }

    if (fs.existsSync(runDir)) {
      throw new Error(`run ${runId} already exists`);
    }

    fs.mkdirSync(runDir);
    fs.mkdirSync(path.join(runDir, 'steps'));

    return runDir;
  }

  /**
   * create a step directory within a run
   */
  createStepDir(runId: string, stepNumber: number): string {
    const stepDir = path.join(this.runsDir, runId, 'steps', this.padStepNumber(stepNumber));

    if (!fs.existsSync(stepDir)) {
      fs.mkdirSync(stepDir, { recursive: true });
    }

    return stepDir;
  }

  /**
   * import a /share transcript and parse it
   */
  importShare(runId: string, stepNumber: number, agentName: string, transcriptPathOrContent: string): StepShare {
    const stepDir = this.createStepDir(runId, stepNumber);

    // determine if input is path or content
    let content: string;

    if (fs.existsSync(transcriptPathOrContent)) {
      // it's a file path
      content = fs.readFileSync(transcriptPathOrContent, 'utf8');
    } else if (transcriptPathOrContent.startsWith('http')) {
      // it's a URL - not supported yet
      throw new Error('URL import not yet implemented');
    } else {
      // treat as raw content
      content = transcriptPathOrContent;
    }

    // parse the share transcript
    const parser = new ShareParser();
    const index = parser.parse(content);

    // save the share transcript to step directory
    const sharePath = path.join(stepDir, 'share.md');
    fs.writeFileSync(sharePath, content, 'utf8');

    // save the index
    const indexPath = path.join(stepDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');

    // create step share record
    const stepShare: StepShare = {
      stepNumber,
      agentName,
      transcriptPath: sharePath,
      index,
      importedAt: new Date().toISOString()
    };

    // update run context
    this.updateRunContext(runId, stepShare);

    return stepShare;
  }

  /**
   * get prior context for a step (all previous shares)
   */
  getPriorContext(runId: string, currentStep: number): StepShare[] {
    const runContextPath = path.join(this.runsDir, runId, 'context.json');

    if (!fs.existsSync(runContextPath)) {
      return [];
    }

    const context: RunContext = JSON.parse(fs.readFileSync(runContextPath, 'utf8'));

    return context.shares
      .filter(share => share.stepNumber < currentStep)
      .sort((a, b) => a.stepNumber - b.stepNumber);
  }

  /**
   * generate context summary for next step
   */
  generateContextSummary(runId: string, currentStep: number): string {
    const priorShares = this.getPriorContext(runId, currentStep);

    if (priorShares.length === 0) {
      return 'no prior context';
    }

    const lines: string[] = [];
    lines.push('context from prior steps:');
    lines.push('');

    for (const share of priorShares) {
      lines.push(`step ${share.stepNumber} (${share.agentName}):`);

      if (share.index.changedFiles.length > 0) {
        lines.push(`  changed files: ${share.index.changedFiles.join(', ')}`);
      }

      if (share.index.testsRun.length > 0) {
        const verifiedTests = share.index.testsRun.filter(t => t.verified);
        if (verifiedTests.length > 0) {
          lines.push(`  tests verified: ${verifiedTests.map(t => t.command).join(', ')}`);
        }
      }

      if (share.index.prLinks.length > 0) {
        lines.push(`  PRs created: ${share.index.prLinks.join(', ')}`);
      }

      // check for unverified claims
      const unverified = share.index.claims.filter(c => !c.verified);
      if (unverified.length > 0) {
        lines.push(`  ⚠ unverified claims: ${unverified.length}`);
        unverified.forEach(claim => {
          lines.push(`    - ${claim.claim.substring(0, 80)}`);
          lines.push(`      reason: ${claim.evidence}`);
        });
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * save summary for a step
   */
  saveSummary(runId: string, stepNumber: number, summary: string): void {
    const stepDir = this.createStepDir(runId, stepNumber);
    const summaryPath = path.join(stepDir, 'summary.md');
    fs.writeFileSync(summaryPath, summary, 'utf8');
  }

  /**
   * save verification notes for a step
   */
  saveVerification(runId: string, stepNumber: number, verification: string): void {
    const stepDir = this.createStepDir(runId, stepNumber);
    const verificationPath = path.join(stepDir, 'verification.md');
    fs.writeFileSync(verificationPath, verification, 'utf8');
  }

  /**
   * get unverified claims across all steps in a run
   */
  getUnverifiedClaims(runId: string): Array<{ step: number; agent: string; claims: ShareIndex['claims'] }> {
    const runContextPath = path.join(this.runsDir, runId, 'context.json');

    if (!fs.existsSync(runContextPath)) {
      return [];
    }

    const context: RunContext = JSON.parse(fs.readFileSync(runContextPath, 'utf8'));

    return context.shares
      .map(share => ({
        step: share.stepNumber,
        agent: share.agentName,
        claims: share.index.claims.filter(c => !c.verified)
      }))
      .filter(item => item.claims.length > 0);
  }

  private updateRunContext(runId: string, stepShare: StepShare): void {
    const runContextPath = path.join(this.runsDir, runId, 'context.json');

    let context: RunContext;

    if (fs.existsSync(runContextPath)) {
      context = JSON.parse(fs.readFileSync(runContextPath, 'utf8'));
    } else {
      context = {
        runId,
        runDir: path.join(this.runsDir, runId),
        shares: []
      };
    }

    // remove any existing share for this step (replace)
    context.shares = context.shares.filter(s => s.stepNumber !== stepShare.stepNumber);

    // add new share
    context.shares.push(stepShare);

    // sort by step number
    context.shares.sort((a, b) => a.stepNumber - b.stepNumber);

    // save
    fs.writeFileSync(runContextPath, JSON.stringify(context, null, 2), 'utf8');
  }

  private padStepNumber(stepNumber: number): string {
    return stepNumber.toString().padStart(2, '0');
  }
}

export default SessionManager;
