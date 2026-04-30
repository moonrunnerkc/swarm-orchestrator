import * as assert from 'assert';
import { DeploymentMetadata } from '../src/deployment-manager.js';
import ExternalToolManager from '../src/external-tool-manager.js';
import PRAutomation from '../src/pr-automation.js';
import { SwarmExecutionContext } from '../src/swarm-orchestrator.js';

describe('PRAutomation', () => {
  const createMockContext = (): SwarmExecutionContext => ({
    plan: {
      goal: 'Build a todo app with auth',
      steps: [
        {
          stepNumber: 1,
          task: 'Setup project',
          agentName: 'worker',
          dependencies: [],
          expectedOutputs: []
        },
        {
          stepNumber: 2,
          task: 'Add authentication',
          agentName: 'worker',
          dependencies: [1],
          expectedOutputs: []
        }
      ],
      createdAt: new Date().toISOString()
    },
    runDir: '/tmp/test-run',
    executionId: 'exec-123',
    startTime: new Date().toISOString(),
    results: [
      {
        stepNumber: 1,
        agentName: 'worker',
        status: 'completed',
        startTime: new Date().toISOString(),
        ...({
          endTime: new Date().toISOString(),
          verificationResult: {
            stepNumber: 1,
            agentName: 'worker',
            passed: true,
            checks: [],
            unverifiedClaims: [],
            timestamp: new Date().toISOString(),
            transcriptPath: '/tmp/test'
          }
        })
      },
      {
        stepNumber: 2,
        agentName: 'worker',
        status: 'completed',
        startTime: new Date().toISOString(),
        ...({
          endTime: new Date().toISOString(),
          verificationResult: {
            stepNumber: 2,
            agentName: 'worker',
            passed: true,
            checks: [],
            unverifiedClaims: [],
            timestamp: new Date().toISOString(),
            transcriptPath: '/tmp/test'
          }
        })
      }
    ],
    contextBroker: {} as any,
    mainBranch: 'main'
  });

  it('should generate PR summary with execution details', () => {
    const toolManager = new ExternalToolManager({
      enableExternal: true,
      dryRun: true
    });
    const prAutomation = new PRAutomation(toolManager);
    const context = createMockContext();
    const deployments: DeploymentMetadata[] = [];

    const summary = prAutomation.generatePRSummary(context, deployments);

    assert.strictEqual(summary.title, '[Swarm] Build a todo app with auth');
    assert.strictEqual(summary.baseBranch, 'main');
    assert.strictEqual(summary.headBranch, 'swarm/exec-123');
    assert.ok(summary.body.includes('Execution ID'));
    assert.ok(summary.body.includes('2/2 steps'));
    assert.ok(summary.body.includes('Step 1'));
    assert.ok(summary.body.includes('Step 2'));
  });

  it('should include deployment links in PR summary', () => {
    const toolManager = new ExternalToolManager({
      enableExternal: true,
      dryRun: true
    });
    const prAutomation = new PRAutomation(toolManager);
    const context = createMockContext();
    const deployments: DeploymentMetadata[] = [
      {
        stepNumber: 2,
        agentName: 'worker',
        timestamp: new Date().toISOString(),
        platform: 'vercel',
        previewUrl: 'https://app-preview.vercel.app',
        branchName: 'swarm/exec-123'
      }
    ];

    const summary = prAutomation.generatePRSummary(context, deployments);

    assert.ok(summary.body.includes('Preview Deployments'));
    assert.ok(summary.body.includes('https://app-preview.vercel.app'));
    assert.ok(summary.body.includes('vercel'));
  });

  it('should show failed steps in PR summary', () => {
    const toolManager = new ExternalToolManager({
      enableExternal: true,
      dryRun: true
    });
    const prAutomation = new PRAutomation(toolManager);
    const context = createMockContext();

    // Add a failed step
    context.results.push({
      stepNumber: 3,
      agentName: 'worker',
      status: 'failed',
      startTime: new Date().toISOString(),
      ...({
        endTime: new Date().toISOString(),
        verificationResult: {
          stepNumber: 3,
          agentName: 'worker',
          passed: false,
          checks: [],
          unverifiedClaims: ['Tests failed'],
          timestamp: new Date().toISOString(),
          transcriptPath: '/tmp/test'
        }
      })
    });

    const summary = prAutomation.generatePRSummary(context, []);

    assert.ok(summary.body.includes('1 step(s) failed'));
    assert.ok(summary.body.includes('❌'));
  });

  it('should handle PR creation failure when gh not available', async () => {
    const toolManager = new ExternalToolManager({
      enableExternal: true,
      dryRun: false
    });
    const prAutomation = new PRAutomation(toolManager);

    // Mock tools not available by using a path without gh
    const tools = await toolManager.detectAvailableTools();

    if (!tools.gh) {
      const result = await prAutomation.createPR({
        title: 'Test PR',
        body: 'Test',
        baseBranch: 'main',
        headBranch: 'feature'
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('gh CLI not available'));
    }
  });
});
