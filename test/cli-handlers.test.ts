import * as assert from 'assert';
import {
  parseSwarmFlags,
  showUsage,
  handleRecipesCommand,
  handleRecipeInfoCommand,
  ExecuteSwarmCliOptions,
} from '../src/cli/index';

describe('cli-handlers', () => {

  describe('parseSwarmFlags', () => {
    it('should return empty options for no flags', () => {
      const opts = parseSwarmFlags([]);
      assert.strictEqual(opts.model, undefined);
      assert.strictEqual(opts.noDashboard, undefined);
      assert.strictEqual(opts.costEstimateOnly, undefined);
    });

    it('should parse --model with value', () => {
      const opts = parseSwarmFlags(['--model', 'claude-opus-4']);
      assert.strictEqual(opts.model, 'claude-opus-4');
    });

    it('should ignore --model without a following value', () => {
      const opts = parseSwarmFlags(['--model']);
      assert.strictEqual(opts.model, undefined);
    });

    it('should parse boolean flags', () => {
      const flags: Array<[string, keyof ExecuteSwarmCliOptions]> = [
        ['--no-dashboard', 'noDashboard'],
        ['--confirm-deploy', 'confirmDeploy'],
        ['--no-quality-gates', 'noQualityGates'],
        ['--pm', 'pm'],
        ['--governance', 'governance'],
        ['--strict-isolation', 'strictIsolation'],
        ['--lean', 'lean'],
        ['--cost-estimate-only', 'costEstimateOnly'],
        ['--plan-cache', 'planCache'],
        ['--replay', 'replay'],
        ['--fleet', 'fleetWaveMode'],
      ];

      for (const [flag, key] of flags) {
        const opts = parseSwarmFlags([flag]);
        assert.strictEqual(opts[key], true, `${flag} should set ${key} to true`);
      }
    });

    it('should parse --useInnerFleet and --wrap-fleet as aliases', () => {
      const opts1 = parseSwarmFlags(['--useInnerFleet']);
      assert.strictEqual(opts1.useInnerFleet, true);

      const opts2 = parseSwarmFlags(['--wrap-fleet']);
      assert.strictEqual(opts2.useInnerFleet, true);
    });

    it('should parse --yes and -y as aliases', () => {
      assert.strictEqual(parseSwarmFlags(['--yes']).yes, true);
      assert.strictEqual(parseSwarmFlags(['-y']).yes, true);
    });

    it('should parse --max-premium-requests with valid integer', () => {
      const opts = parseSwarmFlags(['--max-premium-requests', '50']);
      assert.strictEqual(opts.maxPremiumRequests, 50);
    });

    it('should parse --max-premium-requests with zero', () => {
      const opts = parseSwarmFlags(['--max-premium-requests', '0']);
      assert.strictEqual(opts.maxPremiumRequests, 0);
    });

    it('should throw for --max-premium-requests with negative value', () => {
      assert.throws(
        () => parseSwarmFlags(['--max-premium-requests', '-1']),
        (err: Error) => {
          assert.ok(err.message.includes('non-negative integer'));
          assert.ok(err.message.includes('-1'));
          return true;
        }
      );
    });

    it('should throw for --max-premium-requests with non-numeric value', () => {
      assert.throws(
        () => parseSwarmFlags(['--max-premium-requests', 'abc']),
        (err: Error) => {
          assert.ok(err.message.includes('non-negative integer'));
          assert.ok(err.message.includes('abc'));
          return true;
        }
      );
    });

    it('should parse --resume with session id', () => {
      const opts = parseSwarmFlags(['--resume', 'exec-12345']);
      assert.strictEqual(opts.session, 'exec-12345');
    });

    it('should parse --pr with valid mode', () => {
      assert.strictEqual(parseSwarmFlags(['--pr', 'auto']).prMode, 'auto');
      assert.strictEqual(parseSwarmFlags(['--pr', 'review']).prMode, 'review');
    });

    it('should throw for --pr with invalid mode', () => {
      assert.throws(
        () => parseSwarmFlags(['--pr', 'merge']),
        (err: Error) => {
          assert.ok(err.message.includes('"auto" or "review"'));
          assert.ok(err.message.includes('merge'));
          return true;
        }
      );
    });

    it('should parse --quality-gates-config path', () => {
      const opts = parseSwarmFlags(['--quality-gates-config', '/tmp/qg.yaml']);
      assert.strictEqual(opts.qualityGatesConfigPath, '/tmp/qg.yaml');
    });

    it('should parse --quality-gates-out directory', () => {
      const opts = parseSwarmFlags(['--quality-gates-out', '/tmp/reports']);
      assert.strictEqual(opts.qualityGatesOutDir, '/tmp/reports');
    });

    it('should parse --target directory', () => {
      const opts = parseSwarmFlags(['--target', '/home/user/project']);
      assert.strictEqual(opts.targetDir, '/home/user/project');
    });

    it('should parse --tool agent name', () => {
      const opts = parseSwarmFlags(['--tool', 'claude-code']);
      assert.strictEqual(opts.cliAgent, 'claude-code');
    });

    it('should parse --hooks and --no-hooks', () => {
      assert.strictEqual(parseSwarmFlags(['--hooks']).hooksEnabled, true);
      assert.strictEqual(parseSwarmFlags(['--no-hooks']).hooksEnabled, false);
    });

    it('should handle multiple flags combined', () => {
      const opts = parseSwarmFlags([
        '--model', 'o3',
        '--lean',
        '--governance',
        '--pr', 'review',
        '--max-premium-requests', '100',
        '-y',
      ]);
      assert.strictEqual(opts.model, 'o3');
      assert.strictEqual(opts.lean, true);
      assert.strictEqual(opts.governance, true);
      assert.strictEqual(opts.prMode, 'review');
      assert.strictEqual(opts.maxPremiumRequests, 100);
      assert.strictEqual(opts.yes, true);
    });
  });

  describe('showUsage', () => {
    it('should not throw', () => {
      // Capture stdout to avoid polluting test output
      const originalLog = console.log;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => lines.push(args.join(' '));
      try {
        showUsage();
        assert.ok(lines.length > 0, 'should produce output');
        const output = lines.join('\n');
        assert.ok(output.includes('swarm'), 'should mention swarm command');
        assert.ok(output.includes('--model'), 'should mention --model flag');
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('handleRecipesCommand', () => {
    it('should return 0', () => {
      const originalLog = console.log;
      console.log = () => {};
      try {
        const code = handleRecipesCommand();
        assert.strictEqual(code, 0);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('handleRecipeInfoCommand', () => {
    it('should return 1 when no recipe name provided', () => {
      const originalError = console.error;
      console.error = () => {};
      try {
        const code = handleRecipeInfoCommand([]);
        assert.strictEqual(code, 1);
      } finally {
        console.error = originalError;
      }
    });

    it('should return 1 for unknown recipe name', () => {
      const originalError = console.error;
      console.error = () => {};
      try {
        const code = handleRecipeInfoCommand(['recipe-info', 'nonexistent-recipe-xyz']);
        assert.strictEqual(code, 1);
      } finally {
        console.error = originalError;
      }
    });
  });
});
