import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import ShareParser, { ShareIndex } from './share-parser';
import { DEFAULT_FAILURE_CONTEXT_CHARS } from './defaults';
import { runOutcomeChecks as runOutcomeChecksImpl } from './verifier/outcome-checks';
import {
  buildSummary as buildSummaryImpl,
  crossReferenceEvidence as crossReferenceEvidenceImpl,
  verifyAllClaims as verifyAllClaimsImpl,
  verifyBuild as verifyBuildImpl,
  verifyCommits as verifyCommitsImpl,
  verifyTests as verifyTestsImpl,
} from './verifier/transcript-checks';
import {
  generateVerificationReport as generateVerificationReportImpl,
  commitVerificationReport as commitVerificationReportImpl,
} from './verifier/verification-reporters';
import { getLogger } from './logger';
const logger = getLogger('verifier-engine');

export interface VerificationCheck {
  type: 'test' | 'build' | 'lint' | 'commit' | 'claim' | 'output'
    | 'git_diff' | 'file_existence' | 'build_exec' | 'test_exec'
    | 'cross_step_contract' | 'behavioral_preservation' | 'schema_evolution';
  description: string;
  required: boolean;
  passed: boolean;
  evidence?: string;
  reason?: string;
}

export interface VerificationResult {
  stepNumber: number;
  agentName: string;
  passed: boolean;
  checks: VerificationCheck[];
  unverifiedClaims: string[];
  timestamp: string;
  transcriptPath: string;
  gracefulFailure?: boolean;
  degradationReason?: string | undefined;
  failureContext?: string | undefined;
  summary?: string | undefined;
  baseSha?: string | undefined;
}

export interface OutcomeVerificationOpts {
  workdir: string;
  baseSha: string;
  expectedFiles?: string[];
  /** Cross-step contract inputs (file paths or `file:symbol` refs). */
  requiredInputs?: string[];
  /** Pre-step test snapshot for behavioral preservation on refactor steps. */
  preTestSnapshot?: import('./verifier/behavioral-checks').TestSnapshot;
  /** Schema evolution config for migration-intent steps. */
  schemaEvolution?: import('./verifier/schema-evolution-checks').SchemaEvolutionOpts;
}

export interface RollbackResult {
  success: boolean;
  commitReverted?: string;
  filesRestored: string[];
  error?: string;
}

/**
 * Truncate output to the last 20 lines for error display.
 * Returns the full string if it has 20 lines or fewer.
 */
export function last20Lines(output: string): string {
  const lines = output.split('\n');
  if (lines.length <= 20) return output;
  return '...\n' + lines.slice(-20).join('\n');
}

// Ordering for failure context: more actionable types first
const FAILURE_TYPE_PRIORITY: Record<string, number> = {
  cross_step_contract: 0,
  file_existence: 1,
  behavioral_preservation: 2,
  schema_evolution: 3,
  test_exec: 4,
  build_exec: 5,
  git_diff: 6,
};

/**
 * Build a structured failure context string from failed checks.
 * Ordered by actionability and truncated to ~500 tokens (2000 chars).
 */
export function buildFailureContext(checks: VerificationCheck[]): string {
  const failed = checks.filter(c => !c.passed);
  if (failed.length === 0) return '';

  failed.sort((a, b) => {
    const pa = FAILURE_TYPE_PRIORITY[a.type] ?? 10;
    const pb = FAILURE_TYPE_PRIORITY[b.type] ?? 10;
    return pa - pb;
  });

  const lines = failed.map(c => `- ${c.type}: ${c.reason || c.description}`);
  const joined = lines.join('\n');

  // ~500 tokens at 4 chars/token = 2000 chars
  if (joined.length > DEFAULT_FAILURE_CONTEXT_CHARS) {
    return joined.slice(0, DEFAULT_FAILURE_CONTEXT_CHARS) + '\n... (truncated)';
  }
  return joined;
}

/**
 * Verifier Engine - proactive real-time verification and drift prevention
 * Validates agent claims against actual evidence in transcripts
 */
export class VerifierEngine {
  private shareParser: ShareParser;
  private workingDir: string;

  constructor(workingDir?: string) {
    this.workingDir = workingDir || process.cwd();
    this.shareParser = new ShareParser();
  }

  /**
   * Verify a completed step by analyzing its transcript
   */
  async verifyStep(
    stepNumber: number,
    agentName: string,
    transcriptPath: string,
    requirements?: {
      requireTests?: boolean;
      requireBuild?: boolean;
      requireCommits?: boolean;
      gracefulDegradation?: boolean; // Allow continuation even if verification fails
    },
    preParsedIndex?: ShareIndex,
    evidenceLogPath?: string,
    outcomeOpts?: OutcomeVerificationOpts
  ): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const unverifiedClaims: string[] = [];

    // Read and parse transcript
    if (!fs.existsSync(transcriptPath)) {
      return {
        stepNumber,
        agentName,
        passed: false,
        checks: [{
          type: 'claim',
          description: 'Transcript file exists',
          required: true,
          passed: false,
          reason: `Transcript not found: ${transcriptPath}`
        }],
        unverifiedClaims: [],
        timestamp: new Date().toISOString(),
        transcriptPath
      };
    }

    // Skip re-parse when the caller already parsed the transcript
    const shareIndex = preParsedIndex ?? (() => {
      const transcriptContent = fs.readFileSync(transcriptPath, 'utf8');
      return this.shareParser.parse(transcriptContent);
    })();

    // Verify tests if required
    if (requirements?.requireTests) {
      const testCheck = this.verifyTests(shareIndex);
      checks.push(testCheck);
    }

    // Verify build if required
    if (requirements?.requireBuild) {
      const buildCheck = this.verifyBuild(shareIndex);
      checks.push(buildCheck);
    }

    // Verify commits if required
    if (requirements?.requireCommits) {
      const commitCheck = this.verifyCommits(shareIndex);
      checks.push(commitCheck);
    }

    // Check for unverified claims (drift detection) - these are warnings only
    const claimCheck = this.verifyAllClaims(shareIndex);
    checks.push(...claimCheck.checks);
    unverifiedClaims.push(...claimCheck.unverifiedClaims);

    // Cross-reference hook evidence against transcript claims (defense in depth)
    if (evidenceLogPath) {
      const hookEvidence = this.crossReferenceEvidence(shareIndex, evidenceLogPath);
      checks.push(...hookEvidence);
    }

    // Outcome-based checks: run when the caller provides worktree info
    if (outcomeOpts) {
      const outcomeChecks = this.runOutcomeChecks(outcomeOpts);
      checks.push(...outcomeChecks);

      // Demote transcript-parsed test/build checks when real execution checks exist
      const hasOutcomeExecChecks = checks.some(
        c => c.type === 'build_exec' || c.type === 'test_exec'
      );
      if (hasOutcomeExecChecks) {
        for (const c of checks) {
          if (c.type === 'build' || c.type === 'test') {
            c.required = false;
          }
        }
      }
    }

    // Overall pass/fail: every required check must pass (vacuously true when none are required)
    const passed = checks.every(c => !c.required || c.passed);

    // Build failure context for repair agent consumption
    const failureContext = passed ? undefined : buildFailureContext(checks);
    const summary = this.buildSummary(checks, passed);

    // Apply graceful degradation if enabled and verification failed
    let gracefulFailure = false;
    let degradationReason: string | undefined;

    if (!passed && requirements?.gracefulDegradation) {
      gracefulFailure = true;
      const failedRequired = checks.filter(c => c.required && !c.passed);
      degradationReason = `Verification failed but graceful degradation enabled. Failed checks: ${failedRequired.map(c => c.type).join(', ')}`;
    }

    const result: VerificationResult = {
      stepNumber,
      agentName,
      passed: passed || gracefulFailure,
      checks,
      unverifiedClaims,
      timestamp: new Date().toISOString(),
      transcriptPath,
      gracefulFailure,
      degradationReason,
      failureContext,
      summary,
      baseSha: outcomeOpts?.baseSha,
    };

    return result;
  }

  private runOutcomeChecks(opts: OutcomeVerificationOpts): VerificationCheck[] {
    return runOutcomeChecksImpl(opts, this.workingDir);
  }

  private buildSummary(checks: VerificationCheck[], passed: boolean): string {
    return buildSummaryImpl(checks, passed);
  }

  private verifyTests(shareIndex: ShareIndex): VerificationCheck {
    return verifyTestsImpl(shareIndex);
  }

  private verifyBuild(shareIndex: ShareIndex): VerificationCheck {
    return verifyBuildImpl(shareIndex);
  }

  private verifyCommits(shareIndex: ShareIndex): VerificationCheck {
    return verifyCommitsImpl(shareIndex);
  }

  private verifyAllClaims(shareIndex: ShareIndex): {
    checks: VerificationCheck[];
    unverifiedClaims: string[];
  } {
    return verifyAllClaimsImpl(shareIndex);
  }

  /**
   * Verify expected outputs by checking files and content in the worktree.
   * Each expectedOutput string is parsed for file paths and key terms,
   * then verified against the actual file system.
   */
  verifyExpectedOutputs(
    stepNumber: number,
    agentName: string,
    expectedOutputs: string[],
    worktreeDir: string
  ): VerificationCheck[] {
    const checks: VerificationCheck[] = [];

    // Regex to extract file paths from expected output descriptions
    const filePathRegex = /\b((?:src|test|tests|server|config|public)\/[\w./-]+\.\w+|[\w-]+\.\w{2,4})\b/g;
    // Key terms that can be grepped in source files
    const termPatterns: Array<{ term: string; regex: RegExp }> = [
      { term: 'aria-label', regex: /aria-label/i },
      { term: 'aria-live', regex: /aria-live/i },
      { term: 'role="alert"', regex: /role\s*=\s*["']alert["']/i },
      { term: 'focus-visible', regex: /:focus-visible/i },
      { term: 'skip-link', regex: /skip-link|skip.to.content|#main-content/i },
      { term: 'ErrorBoundary', regex: /ErrorBoundary/i },
      { term: 'AbortController', regex: /AbortController/i },
      { term: 'retry', regex: /retry|backoff/i },
      { term: 'responsive breakpoint', regex: /@media\s*\(/i },
      { term: 'heading hierarchy', regex: /<h[12]/i },
      { term: 'skeleton shimmer', regex: /skeleton|shimmer/i },
      { term: 'animation', regex: /animation\s*[:={]/i }
    ];

    for (const expected of expectedOutputs) {
      const filePaths: string[] = [];
      let match: RegExpExecArray | null;
      const pathRegex = new RegExp(filePathRegex.source, 'g');

      while ((match = pathRegex.exec(expected)) !== null) {
        // Skip common false positives like version numbers
        if (/^\d+\.\d+/.test(match[1])) continue;
        filePaths.push(match[1]);
      }

      if (filePaths.length > 0) {
        // File-existence check: verify at least one mentioned file exists
        const existingFiles = filePaths.filter(fp => {
          const fullPath = path.join(worktreeDir, fp);
          return fs.existsSync(fullPath);
        });

        if (existingFiles.length > 0) {
          checks.push({
            type: 'output',
            description: `Expected files present: ${existingFiles.join(', ')}`,
            required: false,
            passed: true,
            evidence: `${existingFiles.length}/${filePaths.length} expected files found in worktree`
          });
        } else {
          checks.push({
            type: 'output',
            description: `Expected files: ${filePaths.join(', ')}`,
            required: false,
            passed: false,
            reason: `None of the expected files found in ${worktreeDir}`,
            evidence: `Looked for: ${filePaths.join(', ')}`
          });
        }

        // Content check: grep existing files for key terms mentioned in expected output
        const lowerExpected = expected.toLowerCase();
        for (const { term, regex } of termPatterns) {
          if (!lowerExpected.includes(term.toLowerCase().split(/[="]/)[0])) continue;

          const found = existingFiles.some(fp => {
            try {
              const content = fs.readFileSync(path.join(worktreeDir, fp), 'utf8');
              return regex.test(content);
            } catch {
              // File may be binary or permission-restricted; skip it
              return false;
            }
          });

          if (found) {
            checks.push({
              type: 'output',
              description: `"${term}" found in output files`,
              required: false,
              passed: true,
              evidence: `Matched ${term} pattern in generated code`
            });
          }
        }
      } else {
        // No file paths extracted; try to match key terms across all changed files
        const lowerExpected = expected.toLowerCase();
        const matchedTerms: string[] = [];

        for (const { term, regex } of termPatterns) {
          if (!lowerExpected.includes(term.toLowerCase().split(/[="]/)[0])) continue;

          // Search all non-binary files in worktree src/ and test/
          const searchDirs = ['src', 'test', 'tests', 'server'].map(d => path.join(worktreeDir, d));
          let found = false;

          for (const dir of searchDirs) {
            if (!fs.existsSync(dir)) continue;
            try {
              const files = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' });
              for (const file of files) {
                const fullPath = path.join(dir, file);
                try {
                  const stat = fs.statSync(fullPath);
                  if (!stat.isFile() || stat.size > 256 * 1024) continue;
                  const content = fs.readFileSync(fullPath, 'utf8');
                  if (regex.test(content)) { found = true; break; }
                } catch {
                  // Binary or permission-restricted file; skip
                }
              }
            } catch {
              // Directory unreadable (permissions, broken symlink); skip
            }
            if (found) break;
          }

          if (found) matchedTerms.push(term);
        }

        if (matchedTerms.length > 0) {
          checks.push({
            type: 'output',
            description: `Expected features verified: ${matchedTerms.join(', ')}`,
            required: false,
            passed: true,
            evidence: `Found evidence for: ${matchedTerms.join(', ')}`
          });
        }
      }
    }

    return checks;
  }

  /**
   * Generate verification report and save to file
   */
  async generateVerificationReport(
    result: VerificationResult,
    outputPath: string
  ): Promise<void> {
    return generateVerificationReportImpl(result, outputPath);
  }

  /**
   * Rollback changes from a failed step
   */
  async rollback(
    stepNumber: number,
    branchName?: string,
    filesChanged?: string[]
  ): Promise<RollbackResult> {
    const filesRestored: string[] = [];

    try {
      // If on a branch, switch back and delete the branch
      if (branchName) {
        await this.runGitCommand(['checkout', 'main']);
        await this.runGitCommand(['branch', '-D', branchName]);
      }

      // Reset any uncommitted changes
      await this.runGitCommand(['reset', '--hard', 'HEAD']);

      // If specific files were changed, restore them
      if (filesChanged && filesChanged.length > 0) {
        for (const file of filesChanged) {
          try {
            await this.runGitCommand(['checkout', 'HEAD', '--', file]);
            filesRestored.push(file);
          } catch {
            // File does not exist in HEAD (new file from the agent); nothing to restore
          }
        }
      }

      return {
        success: true,
        filesRestored
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        success: false,
        filesRestored,
        error: err.message
      };
    }
  }

  /**
   * Run a git command
   */
  private async runGitCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd: this.workingDir
      });

      let stdout = '';
      let stderr = '';

      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Git command failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Commit verification report with natural message
   * Skips if file is in a gitignored path (e.g., runs/)
   */
  async commitVerificationReport(
    reportPath: string,
    stepNumber: number,
    agentName: string,
    passed: boolean
  ): Promise<void> {
    return commitVerificationReportImpl(
      reportPath,
      this.workingDir,
      stepNumber,
      agentName,
      passed,
      logger,
    );
  }

  /**
   * Cross-reference hook-captured evidence with transcript-based claims.
   * If hooks recorded errors or scope violations that the transcript does not
   * mention, the step fails (defense in depth).
   */
  private crossReferenceEvidence(shareIndex: ShareIndex, evidenceLogPath: string): VerificationCheck[] {
    return crossReferenceEvidenceImpl(shareIndex, evidenceLogPath);
  }
}

export default VerifierEngine;
