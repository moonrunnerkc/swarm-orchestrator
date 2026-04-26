import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PRManager } from '../src/pr-manager';
import { VerificationResult } from '../src/verifier-engine';
import { StepCostRecord } from '../src/metrics-types';
import { GateResult } from '../src/quality-gates';

describe('PRManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-manager-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should default workingDir to process.cwd when not provided', () => {
      const mgr = new PRManager();
      // Verify it constructed without error; workingDir is private, so test via isGhAvailable behavior
      assert.ok(mgr);
    });

    it('should accept a custom working directory', () => {
      const mgr = new PRManager(tempDir);
      assert.ok(mgr);
    });
  });

  describe('isGhAvailable', () => {
    it('should cache the result across calls', function() {
      this.timeout(15000);
      const mgr = new PRManager(tempDir);
      const first = mgr.isGhAvailable();
      const second = mgr.isGhAvailable();
      assert.strictEqual(first, second);
    });

    // gh may or may not be available in the test environment;
    // we only verify the method returns a boolean without throwing
    it('should return a boolean', () => {
      const mgr = new PRManager(tempDir);
      const result = mgr.isGhAvailable();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('formatVerificationEvidence', () => {
    it('should format a passing verification result', () => {
      const mgr = new PRManager(tempDir);
      const result: VerificationResult = {
        stepNumber: 1,
        agentName: 'worker',
        passed: true,
        checks: [
          { type: 'commit', description: 'Has commits', required: true, passed: true, evidence: 'abc1234' },
          { type: 'test', description: 'Tests pass', required: true, passed: true, evidence: '5 passing' }
        ],
        unverifiedClaims: [],
        timestamp: '2026-03-17T10:00:00Z',
        transcriptPath: '/tmp/transcript.md'
      };

      const output = mgr.formatVerificationEvidence(result);
      assert.ok(output.includes('Verification Passed'));
      assert.ok(output.includes('Has commits'));
      assert.ok(output.includes('Tests pass'));
      assert.ok(output.includes('abc1234'));
    });

    it('should format a failing verification with unverified claims', () => {
      const mgr = new PRManager(tempDir);
      const result: VerificationResult = {
        stepNumber: 2,
        agentName: 'worker',
        passed: false,
        checks: [
          { type: 'build', description: 'Build succeeds', required: true, passed: false, reason: 'No build output found' }
        ],
        unverifiedClaims: ['All components render correctly', 'CSS is responsive'],
        timestamp: '2026-03-17T10:00:00Z',
        transcriptPath: '/tmp/transcript2.md'
      };

      const output = mgr.formatVerificationEvidence(result);
      assert.ok(output.includes('Verification Failed'));
      assert.ok(output.includes('No build output found'));
      assert.ok(output.includes('Unverified claims (2)'));
      assert.ok(output.includes('All components render correctly'));
    });

    it('should include graceful failure note when present', () => {
      const mgr = new PRManager(tempDir);
      const result: VerificationResult = {
        stepNumber: 3,
        agentName: 'worker',
        passed: false,
        checks: [],
        unverifiedClaims: [],
        timestamp: '2026-03-17T10:00:00Z',
        transcriptPath: '/tmp/transcript3.md',
        gracefulFailure: true,
        degradationReason: 'Test framework not configured in target project'
      };

      const output = mgr.formatVerificationEvidence(result);
      assert.ok(output.includes('allowed to continue despite verification failure'));
      assert.ok(output.includes('Test framework not configured'));
    });
  });

  describe('formatCostComment', () => {
    it('should format cost record as a markdown table', () => {
      const mgr = new PRManager(tempDir);
      const record: StepCostRecord = {
        stepNumber: 1,
        agentName: 'worker',
        estimatedPremiumRequests: 2,
        actualPremiumRequests: 3,
        retryCount: 1,
        promptTokens: 4500,
        fleetMode: false,
        durationMs: 45000
      };

      const output = mgr.formatCostComment(record);
      assert.ok(output.includes('Estimated Premium Requests | 2'));
      assert.ok(output.includes('Actual Premium Requests | 3'));
      assert.ok(output.includes('Retry Count | 1'));
      assert.ok(output.includes('Prompt Tokens | 4500'));
      assert.ok(output.includes('Fleet Mode | No'));
      assert.ok(output.includes('45.0s'));
    });

    it('should show fleet mode when enabled', () => {
      const mgr = new PRManager(tempDir);
      const record: StepCostRecord = {
        stepNumber: 1,
        agentName: 'worker',
        estimatedPremiumRequests: 5,
        actualPremiumRequests: 4,
        retryCount: 0,
        promptTokens: 8000,
        fleetMode: true,
        durationMs: 120000
      };

      const output = mgr.formatCostComment(record);
      assert.ok(output.includes('Fleet Mode | Yes'));
      assert.ok(output.includes('120.0s'));
    });
  });

  describe('formatGateResultsComment', () => {
    it('should format all-passing gates', () => {
      const mgr = new PRManager(tempDir);
      const gates: GateResult[] = [
        { id: 'scaffold', title: 'Scaffold Defaults', status: 'pass', durationMs: 50, issues: [] },
        { id: 'duplicates', title: 'Duplicate Blocks', status: 'pass', durationMs: 30, issues: [] }
      ];

      const output = mgr.formatGateResultsComment(gates);
      assert.ok(output.includes('All Passed'));
      assert.ok(output.includes('Scaffold Defaults'));
      assert.ok(output.includes('Duplicate Blocks'));
    });

    it('should format failed gates with issues', () => {
      const mgr = new PRManager(tempDir);
      const gates: GateResult[] = [
        {
          id: 'hardcoded',
          title: 'Hardcoded Config',
          status: 'fail',
          durationMs: 40,
          issues: [
            { message: 'Hardcoded port 3000', filePath: 'src/server.ts', line: 15 },
            { message: 'Hardcoded API URL', filePath: 'src/config.ts', line: 8 }
          ]
        },
        { id: 'readme', title: 'README Claims', status: 'pass', durationMs: 20, issues: [] }
      ];

      const output = mgr.formatGateResultsComment(gates);
      assert.ok(output.includes('Issues Found'));
      assert.ok(output.includes('Hardcoded Config'));
      assert.ok(output.includes('src/server.ts:15'));
      assert.ok(output.includes('Hardcoded port 3000'));
    });

    it('should truncate issue list when more than 5 per gate', () => {
      const mgr = new PRManager(tempDir);
      const issues = Array.from({ length: 8 }, (_, i) => ({
        message: `Issue ${i + 1}`,
        filePath: `src/file${i}.ts`,
        line: i + 1
      }));

      const gates: GateResult[] = [
        { id: 'test', title: 'Test Gate', status: 'fail', durationMs: 10, issues }
      ];

      const output = mgr.formatGateResultsComment(gates);
      assert.ok(output.includes('Issue 1'));
      assert.ok(output.includes('Issue 5'));
      assert.ok(output.includes('... and 3 more'));
    });

    it('should handle skipped gates', () => {
      const mgr = new PRManager(tempDir);
      const gates: GateResult[] = [
        { id: 'a11y', title: 'Accessibility', status: 'skip', durationMs: 0, issues: [] }
      ];

      const output = mgr.formatGateResultsComment(gates);
      assert.ok(output.includes('skip'));
      assert.ok(output.includes('All Passed'));
    });
  });

  describe('formatPRBody', () => {
    it('should compose a full PR body with all evidence sections', () => {
      const mgr = new PRManager(tempDir);
      const verification: VerificationResult = {
        stepNumber: 1,
        agentName: 'worker',
        passed: true,
        checks: [
          { type: 'commit', description: 'Has commits', required: true, passed: true, evidence: 'abc123' }
        ],
        unverifiedClaims: [],
        timestamp: '2026-03-17T10:00:00Z',
        transcriptPath: '/tmp/transcript.md'
      };

      const costRecord: StepCostRecord = {
        stepNumber: 1,
        agentName: 'worker',
        estimatedPremiumRequests: 1,
        actualPremiumRequests: 1,
        retryCount: 0,
        promptTokens: 3000,
        fleetMode: false,
        durationMs: 30000
      };

      const gates: GateResult[] = [
        { id: 'scaffold', title: 'Scaffold Defaults', status: 'pass', durationMs: 50, issues: [] }
      ];

      const body = mgr.formatPRBody(1, 'worker', 'Build REST API', {
        verification,
        costRecord,
        gateResults: gates
      });

      assert.ok(body.includes('Swarm Step 1: worker'));
      assert.ok(body.includes('Build REST API'));
      assert.ok(body.includes('Verification'));
      assert.ok(body.includes('Cost Attribution'));
      assert.ok(body.includes('Quality Gates'));
      assert.ok(body.includes('Generated by Swarm Orchestrator'));
    });

    it('should omit sections when evidence is not provided', () => {
      const mgr = new PRManager(tempDir);
      const body = mgr.formatPRBody(2, 'worker', 'Build UI', {});

      assert.ok(body.includes('Swarm Step 2: worker'));
      assert.ok(body.includes('Build UI'));
      assert.ok(!body.includes('### Verification'));
      assert.ok(!body.includes('### Cost Attribution'));
      assert.ok(!body.includes('### Quality Gates'));
    });
  });

  describe('createStepPR', () => {
    it('should return error when gh is not available', () => {
      // Use a non-existent dir to force gh auth status failure
      const mgr = new PRManager('/nonexistent/path/for/test');
      const result = mgr.createStepPR(
        'swarm/test-branch',
        'main',
        1,
        'worker',
        'Build API',
        {}
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('gh CLI') || result.error.includes('PR creation failed'));
    });
  });
});
