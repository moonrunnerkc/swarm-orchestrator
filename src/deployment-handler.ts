import path from 'path';
import { getLogger } from './logger';
import { PlanStep } from './plan-generator';
import { AgentProfile } from './config-loader';
import { DeploymentManager, DeploymentMetadata } from './deployment-manager';
import { ExternalToolManager } from './external-tool-manager';

const logger = getLogger('deployment');

export interface DeploymentContext {
  runDir: string;
  executionId: string;
  results: Array<{ stepNumber: number; branchName?: string }>;
  deployments?: DeploymentMetadata[] | undefined;
}

export async function executeOptionalDeployment(
  workingDir: string,
  step: PlanStep,
  agent: AgentProfile,
  context: DeploymentContext,
  options: { confirmDeploy?: boolean; enableExternal?: boolean; dryRun?: boolean }
): Promise<void> {
  logger.info(`  🚀 Deploying preview (--confirm-deploy)...`);

  const toolManager = new ExternalToolManager({
    enableExternal: options.enableExternal || true,
    dryRun: options.dryRun || false,
    logFile: path.join(context.runDir, 'deployment-commands.log')
  });

  const deploymentManager = new DeploymentManager(toolManager, workingDir);

  try {
    const branchName = context.results.find(r => r.stepNumber === step.stepNumber)?.branchName || 'unknown';

    // tag HEAD before deploy for rollback safety
    let preDeployTag: string | undefined;
    try {
      preDeployTag = deploymentManager.tagPreDeploy(context.executionId);
      logger.info(`  🏷️  Tagged: ${preDeployTag}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.info(`  [deploy] Could not tag pre-deploy (non-fatal): ${msg}`);
    }

    const deployResult = await deploymentManager.deployPreview(branchName);

    if (deployResult.success && deployResult.previewUrl) {
      logger.info(`  ✅ Preview deployed: ${deployResult.previewUrl}`);

      // health check the preview URL
      const healthy = await deploymentManager.runHealthCheck(deployResult.previewUrl);
      if (!healthy && preDeployTag) {
        logger.warn(`  ⚠️  Health check failed, rolling back...`);
        try {
          deploymentManager.rollbackToTag(preDeployTag);
        } catch (rollbackErr: unknown) {
          const msg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          logger.warn(`  ⚠️  Rollback failed: ${msg}`);
        }
        return;
      } else if (healthy) {
        logger.info(`  ✅ Health check passed`);
      }

      // store deployment metadata
      const metadata: DeploymentMetadata = {
        stepNumber: step.stepNumber,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
        platform: deployResult.platform,
        previewUrl: deployResult.previewUrl,
        branchName
      };

      deploymentManager.saveDeploymentMetadata(context.runDir, metadata);

      // add to context deployments
      if (!context.deployments) {
        context.deployments = [];
      }
      context.deployments.push(metadata);
    } else if (deployResult.platform === 'none') {
      logger.info(`  ℹ️  No deployment platform detected (vercel/netlify), skipping`);
    } else {
      logger.warn(`  ⚠️  Deployment failed: ${deployResult.error}`);
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.warn(`  ⚠️  Deployment error: ${err.message}`);
  }
}
