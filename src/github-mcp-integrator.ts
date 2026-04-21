/**
 * GitHub MCP Integration
 * Generates MCP prompts and validates MCP evidence in verification docs
 */

import * as fs from 'fs';
import { MCPEvidence } from './types';

export class GitHubMcpIntegrator {
  /**
   * Generate MCP prompt section for agent instructions
   */
  static generateMcpPromptSection(): string {
    return `
GitHub Context (MCP) Requirements:
- Before making decisions, consult GitHub context using available MCP tools
- Check for: related issues, existing PRs, recent commits, CI workflows
- In your verification section, include an "MCP Evidence" section with:
  * What GitHub context you consulted
  * Specific evidence quoted (issue numbers, PR titles, workflow names, etc.)
  * How it influenced your decisions
- Example MCP Evidence format:
  
  ## MCP Evidence
  - Consulted open issues: Found issue #42 "Add user authentication"
  - Checked existing PRs: No conflicting PRs for auth feature
  - Reviewed CI workflow: .github/workflows/ci.yml runs tests on push
  - Decision: Implemented auth to resolve #42, added tests for CI compatibility

Without MCP evidence in your verification, this step will be flagged.
`.trim();
  }

  /**
   * Generate /delegate prompt section for agent instructions
   */
  static generateDelegatePromptSection(): string {
    return `
Pull Request Creation (via /delegate):
- When your changes are ready, create a PR using the /delegate command
- The /delegate command will guide you through PR creation
- Include the resulting PR URL in your verification section
- Format: "Created PR: https://github.com/owner/repo/pull/123"
- If /delegate is not available or fails, note this in verification

Example verification with PR:
  ## Verification
  - Changed files: src/api.ts, test/api.test.ts
  - Tests run: npm test (14 passing)
  - Created PR: https://github.com/owner/repo/pull/123
`.trim();
  }

  /**
   * Validate MCP evidence in verification.md
   */
  static validateMcpEvidence(verificationPath: string): MCPEvidence {
    const warnings: string[] = [];

    if (!fs.existsSync(verificationPath)) {
      return {
        found: false,
        warnings: ['verification.md not found']
      };
    }

    const content = fs.readFileSync(verificationPath, 'utf-8');

    // look for MCP evidence section
    const mcpSectionMatch = content.match(/##\s+MCP\s+Evidence(.*?)(?=\n##|\n$)/is);
    
    if (!mcpSectionMatch || !mcpSectionMatch[1]) {
      warnings.push('No "## MCP Evidence" section found in verification.md');
      return { found: false, warnings };
    }

    const mcpSection = mcpSectionMatch[1].trim();

    if (mcpSection.length < 50) {
      warnings.push('MCP Evidence section is too short (< 50 chars)');
    }

    // check for specific evidence markers
    const hasIssueReference = /issue\s+#?\d+|issues:/i.test(mcpSection);
    const hasPrReference = /PR\s+#?\d+|pull request/i.test(mcpSection);
    const hasWorkflowReference = /workflow|\.github\/workflows|CI/i.test(mcpSection);
    const hasCommitReference = /commit|sha/i.test(mcpSection);
    const hasDecisionStatement = /decision|influenced|based on|considering/i.test(mcpSection);

    const evidenceCount = [
      hasIssueReference,
      hasPrReference,
      hasWorkflowReference,
      hasCommitReference
    ].filter(Boolean).length;

    if (evidenceCount === 0) {
      warnings.push('MCP Evidence has no specific GitHub references (issues, PRs, workflows, commits)');
    }

    if (!hasDecisionStatement) {
      warnings.push('MCP Evidence should explain how context influenced decisions');
    }

    return {
      found: true,
      section: mcpSection,
      warnings
    };
  }

  /**
   * Extract PR URLs from verification.md
   */
  static extractPrUrls(verificationPath: string): string[] {
    if (!fs.existsSync(verificationPath)) {
      return [];
    }

    const content = fs.readFileSync(verificationPath, 'utf-8');
    
    // github PR URLs
    const urlMatches = content.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/g) || [];
    
    // PR references like "PR: #123" or "Created PR #42"
    const refMatches = content.match(/(?:PR|pull request)\s*:?\s*#(\d+)/gi) || [];
    const prNumbers = refMatches.map(m => m.match(/#(\d+)/)?.[1]).filter(Boolean);

    return [...new Set([...urlMatches, ...prNumbers.map(n => `#${n}`)])];
  }

  /**
   * Format MCP evidence for display
   */
  static formatMcpEvidenceDisplay(evidence: MCPEvidence): string {
    if (!evidence.found) {
      return `⚠ MCP Evidence: NOT FOUND\n${evidence.warnings.map(w => `  - ${w}`).join('\n')}`;
    }

    let output = '✓ MCP Evidence: FOUND\n';
    
    if (evidence.section) {
      output += `\n${evidence.section}\n`;
    }

    if (evidence.warnings.length > 0) {
      output += '\n⚠ Warnings:\n';
      output += evidence.warnings.map(w => `  - ${w}`).join('\n');
    }

    return output;
  }
}
