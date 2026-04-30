import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseSwarmFlags,
  showUsage,
  handleRecipesCommand,
  handleRecipeInfoCommand,
  handleMetricsCommand,
  ExecuteSwarmCliOptions,
} from '../src/cli/index';

describe('cli-handlers', () => {

  describe('parseSwarmFlags', () => {
    it('should return empty options for no flags', () => {
      const opts = parseSwarmFlags([]);
      assert.strictEqual(opts.model, undefined);
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
        ['--confirm-deploy', 'confirmDeploy'],
        ['--no-quality-gates', 'noQualityGates'],
        ['--pm', 'pm'],
        ['--strict-isolation', 'strictIsolation'],
        ['--lean', 'lean'],
        ['--cost-estimate-only', 'costEstimateOnly'],
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

    it('should parse --max-retries with valid integer', () => {
      const opts = parseSwarmFlags(['--max-retries', '5']);
      assert.strictEqual(opts.maxRetries, 5);
    });

    it('should throw for --max-retries with negative value', () => {
      assert.throws(
        () => parseSwarmFlags(['--max-retries', '-1']),
        (err: Error) => {
          assert.ok(err.message.includes('non-negative integer'));
          assert.ok(err.message.includes('-1'));
          return true;
        }
      );
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
        '--pr', 'review',
        '--max-premium-requests', '100',
        '--max-retries', '4',
        '-y',
      ]);
      assert.strictEqual(opts.model, 'o3');
      assert.strictEqual(opts.lean, true);
      assert.strictEqual(opts.prMode, 'review');
      assert.strictEqual(opts.maxPremiumRequests, 100);
      assert.strictEqual(opts.maxRetries, 4);
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

  describe('handleMetricsCommand', () => {
    function setupSession(opts: { gateStatuses: Array<'pass' | 'fail' | 'skip'>; actualPremium?: number; metricsPremium?: number }) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-metrics-'));
      const sessionId = 'swarm-fixture-001';
      const runDir = path.join(tmp, 'runs', sessionId);
      fs.mkdirSync(runDir, { recursive: true });

      const state = {
        sessionId,
        executionId: sessionId,
        status: 'completed' as const,
        graph: { steps: [{ stepNumber: 1 }, { stepNumber: 2 }, { stepNumber: 3 }] },
        lastCompletedStep: 3,
        branchMap: { '1': 'b1', '2': 'b2', '3': 'b3' },
        transcripts: { '1': 't1', '2': 't2', '3': 't3' },
        gateResults: opts.gateStatuses.map((status, idx) => ({
          id: `gate-${idx}`,
          title: `Gate ${idx}`,
          status,
          durationMs: 0,
          issues: [],
        })),
        metrics: opts.metricsPremium === undefined ? {} : { premiumRequests: opts.metricsPremium },
      };
      fs.writeFileSync(path.join(runDir, 'session-state.json'), JSON.stringify(state), 'utf8');

      if (opts.actualPremium !== undefined) {
        fs.writeFileSync(
          path.join(runDir, 'cost-attribution.json'),
          JSON.stringify({ totalActualPremiumRequests: opts.actualPremium }),
          'utf8'
        );
      }

      return { tmp, sessionId };
    }

    async function captureLogger<T>(fn: () => Promise<T>): Promise<{ output: string; result: T }> {
      const lines: string[] = [];
      // Logger.info ultimately writes to process.stderr (when Ink owns stdout)
      // or stdout. Capture both to be robust across modes.
      const origStdout = process.stdout.write.bind(process.stdout);
      const origStderr = process.stderr.write.bind(process.stderr);
      process.stdout.write = ((chunk: Uint8Array | string) => {
        lines.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: Uint8Array | string) => {
        lines.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      }) as typeof process.stderr.write;
      try {
        const result = await fn();
        return { output: lines.join(''), result };
      } finally {
        process.stdout.write = origStdout;
        process.stderr.write = origStderr;
      }
    }

    it('counts skipped gates separately from failed gates', async () => {
      const { tmp, sessionId } = setupSession({
        gateStatuses: ['pass', 'pass', 'skip', 'skip', 'skip', 'skip', 'skip', 'skip', 'skip'],
        actualPremium: 3,
      });
      const cwd = process.cwd();
      try {
        process.chdir(tmp);
        const { output, result } = await captureLogger(() => handleMetricsCommand(['metrics', sessionId]));
        assert.strictEqual(result, 0);
        assert.match(output, /Gates:\s+2 passed, 0 failed, 7 skipped/,
          'gates line should report skipped separately, not lump skip into failed');
      } finally {
        process.chdir(cwd);
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('reads actual premium requests from cost-attribution.json', async () => {
      const { tmp, sessionId } = setupSession({
        gateStatuses: ['pass'],
        actualPremium: 3,
        metricsPremium: 0,
      });
      const cwd = process.cwd();
      try {
        process.chdir(tmp);
        const { output } = await captureLogger(() => handleMetricsCommand(['metrics', sessionId]));
        assert.match(output, /Premium requests:\s*3/,
          'should pull totalActualPremiumRequests from cost-attribution.json, not the stale metrics map');
      } finally {
        process.chdir(cwd);
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('falls back to state.metrics.premiumRequests when cost-attribution.json is missing', async () => {
      const { tmp, sessionId } = setupSession({
        gateStatuses: ['pass'],
        metricsPremium: 5,
      });
      const cwd = process.cwd();
      try {
        process.chdir(tmp);
        const { output } = await captureLogger(() => handleMetricsCommand(['metrics', sessionId]));
        assert.match(output, /Premium requests:\s*5/);
      } finally {
        process.chdir(cwd);
        fs.rmSync(tmp, { recursive: true, force: true });
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
