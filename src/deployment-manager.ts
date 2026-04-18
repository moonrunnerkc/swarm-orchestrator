import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import ExternalToolManager from './external-tool-manager';
import { getLogger } from './logger';
const logger = getLogger('deployment-manager');

export interface DeploymentResult {
  success: boolean;
  previewUrl?: string;
  deploymentId?: string;
  platform: 'vercel' | 'netlify' | 'none';
  output?: string;
  error?: string;
}

export interface DeploymentMetadata {
  stepNumber: number;
  agentName: string;
  timestamp: string;
  platform: string;
  previewUrl?: string;
  deploymentId?: string;
  branchName: string;
}

/**
 * Deployment Manager - handles preview deployments for Vercel and Netlify
 */
export class DeploymentManager {
  private toolManager: ExternalToolManager;
  private workingDir: string;

  constructor(toolManager: ExternalToolManager, workingDir?: string) {
    this.toolManager = toolManager;
    this.workingDir = workingDir || process.cwd();
  }

  /**
   * Detect which deployment platform is configured.
   * Config files take priority over CLI availability (project-specific > global).
   */
  async detectPlatform(): Promise<'vercel' | 'netlify' | 'none'> {
    // 1. Check config files first (project-specific, most reliable)
    const hasVercelConfig = fs.existsSync(path.join(this.workingDir, 'vercel.json'));
    const hasNetlifyConfig = fs.existsSync(path.join(this.workingDir, 'netlify.toml'));

    if (hasVercelConfig) return 'vercel';
    if (hasNetlifyConfig) return 'netlify';

    // 2. Fall back to CLI availability only when no config files present
    const tools = await this.toolManager.detectAvailableTools();
    if (tools.vercel) return 'vercel';
    if (tools.netlify) return 'netlify';

    return 'none';
  }

  /**
   * Deploy preview for a branch
   */
  async deployPreview(branchName: string): Promise<DeploymentResult> {
    const platform = await this.detectPlatform();

    if (platform === 'none') {
      return {
        success: false,
        platform: 'none',
        error: 'No deployment platform detected (Vercel or Netlify)'
      };
    }

    if (platform === 'vercel') {
      return this.deployVercelPreview(branchName);
    } else {
      return this.deployNetlifyPreview(branchName);
    }
  }

  /**
   * Deploy Vercel preview
   */
  private async deployVercelPreview(branchName: string): Promise<DeploymentResult> {
    const execution = await this.toolManager.executeCommand(
      'vercel',
      ['deploy', '--yes'],
      {
        workingDir: this.workingDir,
        requireTool: 'vercel'
      }
    );

    if (execution.exitCode !== 0) {
      return {
        success: false,
        platform: 'vercel',
        error: execution.error || 'Vercel deployment failed',
        ...(execution.output && { output: execution.output })
      };
    }

    // Extract preview URL from Vercel output
    const previewUrl = this.extractVercelUrl(execution.output || '');

    return {
      success: true,
      platform: 'vercel',
      ...(previewUrl && { previewUrl }),
      ...(execution.output && { output: execution.output })
    };
  }

  /**
   * Deploy Netlify preview
   */
  private async deployNetlifyPreview(branchName: string): Promise<DeploymentResult> {
    const execution = await this.toolManager.executeCommand(
      'netlify',
      ['deploy', '--build'],
      {
        workingDir: this.workingDir,
        requireTool: 'netlify'
      }
    );

    if (execution.exitCode !== 0) {
      return {
        success: false,
        platform: 'netlify',
        error: execution.error || 'Netlify deployment failed',
        ...(execution.output && { output: execution.output })
      };
    }

    // Extract draft URL from Netlify output
    const previewUrl = this.extractNetlifyUrl(execution.output || '');

    return {
      success: true,
      platform: 'netlify',
      ...(previewUrl && { previewUrl }),
      ...(execution.output && { output: execution.output })
    };
  }

  /**
   * Extract Vercel preview URL from CLI output
   */
  private extractVercelUrl(output: string): string | undefined {
    // Vercel outputs: "Preview: https://..."
    const match = output.match(/(?:Preview|Inspect):\s+(https:\/\/[^\s]+)/i);
    return match ? match[1] : undefined;
  }

  /**
   * Extract Netlify preview URL from CLI output
   */
  private extractNetlifyUrl(output: string): string | undefined {
    // Netlify outputs: "Draft deploy URL: https://..."
    const match = output.match(/(?:Draft\s+deploy\s+URL|Website\s+Draft\s+URL):\s+(https:\/\/[^\s]+)/i);
    return match ? match[1] : undefined;
  }

  /**
   * Save deployment metadata to run artifacts
   */
  saveDeploymentMetadata(
    runDir: string,
    metadata: DeploymentMetadata
  ): string {
    const deploymentsDir = path.join(runDir, 'deployments');
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const metadataPath = path.join(
      deploymentsDir,
      `step-${metadata.stepNumber}-${metadata.platform}.json`
    );

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    return metadataPath;
  }

  /**
   * Load all deployment metadata from run
   */
  loadDeploymentMetadata(runDir: string): DeploymentMetadata[] {
    const deploymentsDir = path.join(runDir, 'deployments');

    if (!fs.existsSync(deploymentsDir)) {
      return [];
    }

    const files = fs.readdirSync(deploymentsDir);
    const metadata: DeploymentMetadata[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = fs.readFileSync(path.join(deploymentsDir, file), 'utf8');
        metadata.push(JSON.parse(content));
      }
    }

    return metadata.sort((a, b) => a.stepNumber - b.stepNumber);
  }

  /**
   * Tag HEAD before deployment so we can roll back if the health check fails.
   */
  tagPreDeploy(executionId: string): string {
    const tag = `pre-deploy/${executionId}`;
    execSync(`git tag -f ${tag}`, { cwd: this.workingDir, encoding: 'utf8' });
    return tag;
  }

  /**
   * HTTP health check against a preview URL. Retries on non-200 responses.
   */
  async runHealthCheck(url: string, retries: number = 3, intervalMs: number = 20000): Promise<boolean> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (response.ok) return true;
        logger.info(`  [health-check] Attempt ${attempt}/${retries}: HTTP ${response.status}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.info(`  [health-check] Attempt ${attempt}/${retries}: ${msg}`);
      }
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    return false;
  }

  /**
   * Roll back HEAD by reverting the latest commit and recording the event.
   */
  rollbackToTag(tag: string): void {
    execSync('git revert --no-commit HEAD', { cwd: this.workingDir, encoding: 'utf8' });
    execSync(`git commit -m "rollback: revert to ${tag} after failed health check"`, {
      cwd: this.workingDir, encoding: 'utf8'
    });
    logger.info(`  [rollback] Reverted HEAD, tagged from ${tag}`);
  }
}

export default DeploymentManager;
