import { spawn } from 'child_process';
import { GitHubIssueReference } from './bootstrap-types';
import { getLogger } from './logger';
const logger = getLogger('github-issues-ingester');

/**
 * GitHub Issues Ingester - fetch open issues via gh CLI
 * Only used if gh CLI is available and repo has .git directory
 */
export class GitHubIssuesIngester {
  
  /**
   * Check if gh CLI is available
   */
  async isGhCliAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', ['gh']);
      proc.on('close', (code) => {
        resolve(code === 0);
      });
    });
  }

  /**
   * Fetch open issues for a repository
   */
  async fetchIssues(repoPath: string): Promise<GitHubIssueReference[]> {
    const ghAvailable = await this.isGhCliAvailable();
    if (!ghAvailable) {
      logger.warn('gh CLI not available, skipping issue ingestion');
      return [];
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('gh', ['issue', 'list', '--json', 'number,title,url,labels,createdAt', '--limit', '50'], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          logger.warn(`gh issue list failed: ${stderr}`);
          resolve([]);
          return;
        }

        try {
          const rawIssues = JSON.parse(stdout);
          const issues: GitHubIssueReference[] = rawIssues.map((issue: { number: number; title: string; url: string; labels?: Array<{ name?: string } | string>; createdAt: string }) => ({
            number: issue.number,
            title: issue.title,
            url: issue.url,
            labels: issue.labels?.map((l) => typeof l === 'string' ? l : l.name || '') || [],
            repoName: this.extractRepoName(issue.url),
            createdAt: issue.createdAt
          }));
          
          resolve(issues);
        } catch (error) {
          logger.warn(`Failed to parse gh issue output: ${error}`);
          resolve([]);
        }
      });
    });
  }

  /**
   * Extract repo name from GitHub URL
   */
  private extractRepoName(url: string): string {
    const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Link issues to plan context based on keywords
   */
  linkIssuesToTasks(issues: GitHubIssueReference[], goal: string): GitHubIssueReference[] {
    // Simple keyword matching - find issues relevant to goal
    const goalKeywords = goal.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    return issues.filter(issue => {
      const searchText = `${issue.title} ${issue.labels.join(' ')}`.toLowerCase();
      return goalKeywords.some(keyword => searchText.includes(keyword));
    });
  }

  /**
   * Close an issue with a comment
   */
  async closeIssue(
    issueNumber: number,
    comment: string,
    repoPath: string
  ): Promise<{ success: boolean; error?: string }> {
    const ghAvailable = await this.isGhCliAvailable();
    if (!ghAvailable) {
      return { success: false, error: 'gh CLI not available' };
    }

    return new Promise((resolve) => {
      // Add comment first
      const commentProc = spawn('gh', ['issue', 'comment', issueNumber.toString(), '--body', comment], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let commentError = '';
      commentProc.stderr.on('data', (data) => {
        commentError += data.toString();
      });

      commentProc.on('close', (commentCode) => {
        if (commentCode !== 0) {
          resolve({ success: false, error: `Failed to add comment: ${commentError}` });
          return;
        }

        // Then close the issue
        const closeProc = spawn('gh', ['issue', 'close', issueNumber.toString()], {
          cwd: repoPath,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let closeError = '';
        closeProc.stderr.on('data', (data) => {
          closeError += data.toString();
        });

        closeProc.on('close', (closeCode) => {
          if (closeCode !== 0) {
            resolve({ success: false, error: `Failed to close issue: ${closeError}` });
            return;
          }

          resolve({ success: true });
        });
      });
    });
  }

  /**
   * Close multiple issues resolved by a step
   */
  async closeResolvedIssues(
    issueNumbers: number[],
    stepNumber: number,
    agentName: string,
    repoPath: string
  ): Promise<{ closed: number; failed: number }> {
    const comment = `✅ Resolved by swarm orchestrator - Step ${stepNumber} (${agentName})`;
    
    let closed = 0;
    let failed = 0;

    for (const issueNumber of issueNumbers) {
      const result = await this.closeIssue(issueNumber, comment, repoPath);
      if (result.success) {
        closed++;
        logger.info(`  ✓ Closed issue #${issueNumber}`);
      } else {
        failed++;
        logger.warn(`  ✗ Failed to close issue #${issueNumber}: ${result.error}`);
      }
    }

    return { closed, failed };
  }
}

export default GitHubIssuesIngester;
