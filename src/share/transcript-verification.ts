import type { ShareIndex } from '../share-parser';

/**
 * Probabilistic claim-verification pass: scan transcript lines for natural-language
 * claims (tests passing, build successful, commit made) and cross-reference each
 * claim against the deterministic extraction results already produced by the
 * transcript-extraction pass.
 *
 * This is heuristic — line patterns are matched case-insensitively and lines
 * that look like agent-prompt instructions are skipped. Returns a claims[] with
 * verified=true when supporting evidence exists in the index, verified=false
 * otherwise (with a reason).
 */
export function extractClaims(lines: string[], index: ShareIndex): ShareIndex['claims'] {
  const claims: ShareIndex['claims'] = [];

  const instructionPrefixes = [
    'scope:',
    'done when:',
    'role:',
    'rules:',
    'rule:',
    'context:',
    'you are ',
    'your task',
    'your job',
    'your goal',
    'important:',
    'note:',
    'constraints:',
    'requirements:',
  ];

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    const trimmedLower = lowerLine.trim().toLowerCase();

    if (instructionPrefixes.some((prefix) => trimmedLower.startsWith(prefix))) {
      continue;
    }
    if (trimmedLower.match(/^[-*]\s+(ensure|make sure|verify|confirm|must|should)\b/)) {
      continue;
    }

    // tests passing
    if (
      (lowerLine.match(/\btests?\b/) && lowerLine.match(/\b(pass|passed|passing)\b/)) ||
      lowerLine.includes('all tests passed') ||
      lowerLine.includes('tests are passing')
    ) {
      const hasVerifiedTests = index.testsRun.some((t) => t.verified);
      claims.push({
        claim: line.trim(),
        verified: hasVerifiedTests,
        evidence: hasVerifiedTests
          ? `verified test command: ${index.testsRun.find((t) => t.verified)?.command}`
          : 'no test execution found in transcript',
      });
    }

    // build succeeded
    if (
      lowerLine.match(/\b(build|builds)\s+(succeed|succeeded|passed|successful)/i) ||
      lowerLine.includes('compiled successfully')
    ) {
      const hasBuildCommand = index.buildOperations.some((b) => b.verified);
      claims.push({
        claim: line.trim(),
        verified: hasBuildCommand,
        evidence: hasBuildCommand
          ? `verified build with: ${index.buildOperations.find((b) => b.verified)?.tool}`
          : 'no build command found in transcript',
      });
    }

    // lint passing
    if (
      lowerLine.match(/\b(lint|linting)\s+(pass|passed|succeeded)/i) ||
      lowerLine.match(/no\s+lint\s+errors?/i)
    ) {
      const hasLintCommand = index.lintOperations.some((l) => l.verified);
      claims.push({
        claim: line.trim(),
        verified: hasLintCommand,
        evidence: hasLintCommand
          ? `verified lint with: ${index.lintOperations.find((l) => l.verified)?.tool}`
          : 'no lint command found in transcript',
      });
    }

    // deployment
    if (lowerLine.match(/\b(deploy|deployed|deployment)\s+(succeed|succeeded|successful)/i)) {
      const hasDeployCommand = index.commandsExecuted.some(
        (cmd) => cmd.includes('deploy') || cmd.includes('publish'),
      );
      claims.push({
        claim: line.trim(),
        verified: hasDeployCommand,
        evidence: hasDeployCommand
          ? 'verified deployment command found'
          : 'no deployment command found in transcript',
      });
    }

    // package install
    if (lowerLine.match(/\b(installed|added)\s+package/i) || lowerLine.match(/\bnpm\s+install/i)) {
      const hasPackageOp = index.packageOperations.some((op) => op.operation === 'install');
      claims.push({
        claim: line.trim(),
        verified: hasPackageOp,
        evidence: hasPackageOp
          ? `verified package install: ${index.packageOperations.find((op) => op.operation === 'install')?.packages.join(', ')}`
          : 'no package install command found',
      });
    }

    // git commit
    if (lowerLine.match(/\bcommitted\s+(the\s+)?changes?/i) || lowerLine.match(/\bgit\s+commit/i)) {
      const hasCommit = index.gitCommits.length > 0;
      claims.push({
        claim: line.trim(),
        verified: hasCommit,
        evidence: hasCommit
          ? `verified commit: ${index.gitCommits[0]?.message}`
          : 'no git commit found in transcript',
      });
    }

    // MCP consultation
    if (
      lowerLine.match(/\b(consulted|checked|reviewed)\s+(mcp|github|issues?)/i) &&
      (lowerLine.includes('mcp') ||
        lowerLine.includes('github') ||
        lowerLine.includes('context'))
    ) {
      const hasMcp = index.mcpSections.some((m) => m.verified);
      claims.push({
        claim: line.trim(),
        verified: hasMcp,
        evidence: hasMcp
          ? 'verified MCP Evidence section found'
          : 'no MCP Evidence section or insufficient evidence',
      });
    }
  }

  return claims;
}
