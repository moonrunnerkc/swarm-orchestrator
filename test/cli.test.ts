import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  handlePlanCommand,
  parseSwarmFlags,
  showUsage,
  ExecuteSwarmCliOptions,
} from '../src/cli/index';
import { extractPositionalArgs, normalizeLeadingGlobalFlags } from '../src/cli/flags';

describe('CLI Handlers', () => {
  // -----------------------------------------------------------------------
  // parseSwarmFlags
  // -----------------------------------------------------------------------
  describe('parseSwarmFlags', () => {
    it('returns empty options when no flags are present', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json']);
      assert.deepStrictEqual(opts, {});
    });

    it('extracts --model value', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--model', 'claude-opus-4']);
      assert.strictEqual(opts.model, 'claude-opus-4');
    });

    it('sets boolean flags correctly', () => {
      const opts = parseSwarmFlags([
        'swarm', 'plan.json',
        '--confirm-deploy',
        '--no-quality-gates',
        '--pm',
        '--strict-isolation',
        '--lean',
        '--cost-estimate-only',
      ]);
      assert.strictEqual(opts.confirmDeploy, true);
      assert.strictEqual(opts.noQualityGates, true);
      assert.strictEqual(opts.pm, true);
      assert.strictEqual(opts.strictIsolation, true);
      assert.strictEqual(opts.lean, true);
      assert.strictEqual(opts.costEstimateOnly, true);
    });

    it('parses --quiet and -q as quiet=true', () => {
      assert.strictEqual(parseSwarmFlags(['swarm', 'plan.json', '--quiet']).quiet, true);
      assert.strictEqual(parseSwarmFlags(['swarm', 'plan.json', '-q']).quiet, true);
    });

    it('parses --stream-agent as streamAgent=true', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--stream-agent']);
      assert.strictEqual(opts.streamAgent, true);
    });

    it('does not set streamAgent or quiet when flags are absent', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json']);
      assert.strictEqual(opts.streamAgent, undefined);
      assert.strictEqual(opts.quiet, undefined);
    });

    it('maps --wrap-fleet to useInnerFleet', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--wrap-fleet']);
      assert.strictEqual(opts.useInnerFleet, true);
    });

    it('maps --useInnerFleet directly', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--useInnerFleet']);
      assert.strictEqual(opts.useInnerFleet, true);
    });

    it('parses --max-premium-requests as integer', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--max-premium-requests', '50']);
      assert.strictEqual(opts.maxPremiumRequests, 50);
    });

    it('accepts zero for --max-premium-requests', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--max-premium-requests', '0']);
      assert.strictEqual(opts.maxPremiumRequests, 0);
    });

    it('parses --max-retries as integer', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--max-retries', '5']);
      assert.strictEqual(opts.maxRetries, 5);
    });

    it('throws on negative --max-retries', () => {
      assert.throws(
        () => parseSwarmFlags(['swarm', 'plan.json', '--max-retries', '-1']),
        /non-negative integer/
      );
    });

    it('throws on non-numeric --max-premium-requests', () => {
      assert.throws(
        () => parseSwarmFlags(['swarm', 'plan.json', '--max-premium-requests', 'abc']),
        /non-negative integer.*abc/
      );
    });

    it('throws on negative --max-premium-requests', () => {
      assert.throws(
        () => parseSwarmFlags(['swarm', 'plan.json', '--max-premium-requests', '-5']),
        /non-negative integer/
      );
    });

    it('extracts --resume session id', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--resume', 'session-123']);
      assert.strictEqual(opts.session, 'session-123');
    });

    it('extracts --quality-gates-config path', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--quality-gates-config', '/tmp/gates.yaml']);
      assert.strictEqual(opts.qualityGatesConfigPath, '/tmp/gates.yaml');
    });

    it('extracts --quality-gates-out directory', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--quality-gates-out', '/tmp/reports']);
      assert.strictEqual(opts.qualityGatesOutDir, '/tmp/reports');
    });

    it('handles multiple flags together', () => {
      const opts = parseSwarmFlags([
        'swarm', 'plan.json',
        '--model', 'o3',
        '--pm',
        '--max-premium-requests', '100',
        '--max-retries', '4',
        '--lean',
        '--wrap-fleet',
        '--resume', 'prev-session',
      ]);
      assert.strictEqual(opts.model, 'o3');
      assert.strictEqual(opts.pm, true);
      assert.strictEqual(opts.maxPremiumRequests, 100);
      assert.strictEqual(opts.maxRetries, 4);
      assert.strictEqual(opts.lean, true);
      assert.strictEqual(opts.useInnerFleet, true);
      assert.strictEqual(opts.session, 'prev-session');
    });

    it('ignores unknown flags without error', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--unknown-flag', '--verbose']);
      // Unknown flags are silently ignored; known fields remain undefined
      assert.strictEqual(opts.model, undefined);
      assert.strictEqual(opts.pm, undefined);
    });
  });

  // -----------------------------------------------------------------------
  // showUsage
  // -----------------------------------------------------------------------
  describe('showUsage', () => {
    let captured: string;
    const originalLog = console.log;

    beforeEach(() => {
      captured = '';
      console.log = (...args: unknown[]) => { captured += args.join(' ') + '\n'; };
    });
    afterEach(() => { console.log = originalLog; });

    it('prints usage text containing key commands', () => {
      showUsage();
      assert.ok(captured.includes('swarm plan'), 'should mention plan command');
      assert.ok(captured.includes('swarm swarm'), 'should mention swarm command');
      assert.ok(captured.includes('swarm quick'), 'should mention quick command');
      assert.ok(captured.includes('swarm demo'), 'should mention demo command');
      assert.ok(captured.includes('swarm attest verify'), 'should mention attestation verification');
    });

    it('documents cost-related flags', () => {
      showUsage();
      assert.ok(captured.includes('--cost-estimate-only'), 'should list --cost-estimate-only');
      assert.ok(captured.includes('--max-premium-requests'), 'should list --max-premium-requests');
      assert.ok(captured.includes('--max-retries'), 'should list --max-retries');
      assert.ok(captured.includes('--wrap-fleet'), 'should list --wrap-fleet');
    });

    it('documents lean flag', () => {
      showUsage();
      assert.ok(captured.includes('--lean'), 'should list --lean');
    });
  });

  describe('global flag normalization', () => {
    it('moves leading global flags behind the command', () => {
      const normalized = normalizeLeadingGlobalFlags([
        '--verbose',
        '--output',
        'json',
        'plan',
        'Build a REST API',
      ]);
      assert.deepStrictEqual(normalized, [
        'plan',
        '--verbose',
        '--output',
        'json',
        'Build a REST API',
      ]);
    });

    it('treats help as the command when only global flags are provided', () => {
      const normalized = normalizeLeadingGlobalFlags(['--verbose', '--help']);
      assert.deepStrictEqual(normalized, ['--help', '--verbose']);
    });

    it('extracts positional args without leaking output-format values', () => {
      const positional = extractPositionalArgs(
        ['--output', 'json', '--verbose', '--json', 'Build a REST API'],
        {
          booleanFlags: ['--verbose', '--json'],
          valueFlags: ['--output'],
        }
      );
      assert.deepStrictEqual(positional, ['Build a REST API']);
    });
  });

  describe('handlePlanCommand', () => {
    const originalStdoutWrite = process.stdout.write;
    let capturedStdout = '';
    let tempDir = '';
    let originalCwd = '';

    beforeEach(() => {
      capturedStdout = '';
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-plan-test-'));
      originalCwd = process.cwd();
      process.chdir(tempDir);
      process.stdout.write = ((chunk: string | Uint8Array) => {
        capturedStdout += typeof chunk === 'string' ? chunk : chunk.toString();
        return true;
      }) as typeof process.stdout.write;
    });

    afterEach(() => {
      process.stdout.write = originalStdoutWrite;
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('keeps --output json out of the generated goal text', async () => {
      const code = await handlePlanCommand(['plan', '--output', 'json', 'Build a REST API']);
      assert.strictEqual(code, 0);

      const payload = JSON.parse(capturedStdout);
      assert.strictEqual(payload.goal, 'Build a REST API');
      assert.strictEqual(payload.plan.goal, 'Build a REST API');
      assert.ok(!payload.goal.includes('json'));
    });
  });
});
