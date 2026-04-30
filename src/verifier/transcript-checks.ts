import { HookGenerator } from '../hook-generator';
import type { ShareIndex } from '../share-parser';
import type { VerificationCheck } from '../verifier-engine';

export function buildSummary(checks: VerificationCheck[], passed: boolean): string {
  const total = checks.length;
  const passedCount = checks.filter(c => c.passed).length;
  const requiredFailed = checks.filter(c => c.required && !c.passed).length;
  if (passed) {
    return `${passedCount}/${total} checks passed`;
  }
  return `${requiredFailed} required check(s) failed out of ${total} total`;
}

export function verifyTests(shareIndex: ShareIndex): VerificationCheck {
  const testsRun = shareIndex.testsRun;

  if (testsRun.length === 0) {
    return {
      type: 'test',
      description: 'Tests executed',
      required: true,
      passed: false,
      reason: 'No test commands found in transcript'
    };
  }

  const verifiedTests = testsRun.filter(t => t.verified);

  if (verifiedTests.length === 0) {
    return {
      type: 'test',
      description: 'Tests executed with output',
      required: true,
      passed: false,
      reason: 'Test commands found but no test output detected',
      evidence: `Commands: ${testsRun.map(t => t.command).join(', ')}`
    };
  }

  return {
    type: 'test',
    description: 'Tests executed successfully',
    required: true,
    passed: true,
    evidence: `${verifiedTests.length} test(s) verified: ${verifiedTests.map(t => t.command).join(', ')}`
  };
}

export function verifyBuild(shareIndex: ShareIndex): VerificationCheck {
  const builds = shareIndex.buildOperations;

  if (builds.length === 0) {
    return {
      type: 'build',
      description: 'Build executed',
      required: true,
      passed: false,
      reason: 'No build commands found in transcript'
    };
  }

  const verifiedBuilds = builds.filter(b => b.verified);

  if (verifiedBuilds.length === 0) {
    return {
      type: 'build',
      description: 'Build succeeded',
      required: true,
      passed: false,
      reason: 'Build commands found but no success output detected',
      evidence: `Tools: ${builds.map(b => b.tool).join(', ')}`
    };
  }

  return {
    type: 'build',
    description: 'Build succeeded',
    required: true,
    passed: true,
    evidence: `Verified builds: ${verifiedBuilds.map(b => b.tool).join(', ')}`
  };
}

export function verifyCommits(shareIndex: ShareIndex): VerificationCheck {
  const commits = shareIndex.gitCommits;

  if (commits.length === 0) {
    return {
      type: 'commit',
      description: 'Git commits made',
      required: true,
      passed: false,
      reason: 'No git commits found in transcript'
    };
  }

  const verifiedCommits = commits.filter(c => c.verified);

  if (verifiedCommits.length === 0) {
    return {
      type: 'commit',
      description: 'Git commits verified',
      required: true,
      passed: false,
      reason: 'Commit messages found but not verified in output'
    };
  }

  return {
    type: 'commit',
    description: 'Git commits verified',
    required: true,
    passed: true,
    evidence: `${verifiedCommits.length} commit(s): ${verifiedCommits.map(c => c.message).slice(0, 3).join('; ')}${verifiedCommits.length > 3 ? '...' : ''}`
  };
}

export function verifyAllClaims(shareIndex: ShareIndex): {
  checks: VerificationCheck[];
  unverifiedClaims: string[];
} {
  const checks: VerificationCheck[] = [];
  const unverifiedClaims: string[] = [];

  shareIndex.claims.forEach(claim => {
    if (!claim.verified) {
      checks.push({
        type: 'claim',
        description: `Verify claim: "${claim.claim.substring(0, 50)}..."`,
        required: false,
        passed: false,
        reason: claim.evidence || 'No evidence found',
        evidence: claim.claim
      });
      unverifiedClaims.push(claim.claim);
    }
  });

  return { checks, unverifiedClaims };
}

export function crossReferenceEvidence(shareIndex: ShareIndex, evidenceLogPath: string): VerificationCheck[] {
  const fs = require('fs') as typeof import('fs');
  // Hook evidence is only produced by adapters that load hooks from
  // <gitRoot>/.github/hooks/ (currently only Copilot CLI). If the file does
  // not exist, the adapter is not wired for hooks; suppress the check
  // instead of synthesizing a failed "should have but didn't" record that
  // misleads users on claude-code, codex, or claude-code-teams runs.
  if (!fs.existsSync(evidenceLogPath)) {
    return [];
  }

  const hookGen = new HookGenerator();
  const entries = hookGen.parseEvidenceLog(evidenceLogPath);

  if (entries.length === 0) {
    return [{
      type: 'claim',
      description: 'Hook evidence log exists and is non-empty',
      required: false,
      passed: false,
      reason: `Hook evidence log at ${evidenceLogPath} is empty; hooks ran but recorded no events.`
    }];
  }

  const checks: VerificationCheck[] = [];

  const errorEntries = entries.filter(e => e.event === 'errorOccurred');
  const transcriptHasErrors = shareIndex.testsRun.some(t => !t.verified)
    || shareIndex.buildOperations.some(b => !b.verified)
    || shareIndex.claims.some(c => !c.verified);

  if (errorEntries.length > 0 && !transcriptHasErrors) {
    checks.push({
      type: 'claim',
      description: 'Hook error evidence cross-references transcript',
      required: true,
      passed: false,
      evidence: `Hooks captured ${errorEntries.length} error(s) but transcript reports none`,
      reason: `Hook evidence contradicts transcript: ${errorEntries.length} error(s) captured by hooks were not mentioned in transcript`
    });
  } else if (errorEntries.length > 0) {
    checks.push({
      type: 'claim',
      description: 'Hook error evidence cross-references transcript',
      required: false,
      passed: true,
      evidence: `Both hooks (${errorEntries.length}) and transcript acknowledge errors`
    });
  }

  const hookFiles = new Set(
    entries
      .filter(e => e.filePath)
      .map(e => e.filePath as string)
  );
  const transcriptFiles = new Set(shareIndex.changedFiles || []);

  const scopeViolations = entries.filter(e => e.event === 'scope_violation');
  if (scopeViolations.length > 0) {
    const violatedFiles = scopeViolations.map(v => v.filePath || 'unknown').join(', ');
    const agents = [...new Set(scopeViolations.map(v => v.agentName || 'unknown'))];
    const rules = [...new Set(scopeViolations.map(v => v.boundaryRule || 'unknown'))];
    checks.push({
      type: 'claim',
      description: 'No scope violations detected during execution',
      required: true,
      passed: false,
      evidence: `${scopeViolations.length} scope violation(s) logged by hooks`,
      reason: `Agent ${agents.join(', ')} wrote to files outside its declared scope: ${violatedFiles}. Violated boundary rule(s): ${rules.join(', ')}`
    });
  }

  const hookOnlyFiles = [...hookFiles].filter(f => !transcriptFiles.has(f));
  if (hookOnlyFiles.length > 0) {
    checks.push({
      type: 'claim',
      description: 'Hook file evidence has unmentioned files',
      required: false,
      passed: true,
      evidence: `Hooks captured ${hookOnlyFiles.length} file(s) not mentioned in transcript: ${hookOnlyFiles.slice(0, 5).join(', ')}`
    });
  }

  checks.push({
    type: 'claim',
    description: 'Hook evidence corroborates transcript',
    required: false,
    passed: true,
    evidence: `${entries.length} hook evidence entries, ${hookFiles.size} files tracked`
  });

  return checks;
}
