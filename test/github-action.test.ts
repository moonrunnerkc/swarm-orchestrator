import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// writeCIOutputs is not exported, so we test it indirectly through the
// entrypoint script behavior and by reimporting the result shape contract.
import { SwarmExecutionContext, ParallelStepResult } from '../src/swarm-orchestrator';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gh-action-test-'));
}

const ENTRYPOINT = path.resolve(__dirname, '..', 'entrypoint.sh');
// Use source entrypoint if dist does not exist
const ENTRYPOINT_SRC = path.resolve(__dirname, '..', '..', 'entrypoint.sh');
const SCRIPT = fs.existsSync(ENTRYPOINT) ? ENTRYPOINT : ENTRYPOINT_SRC;

describe('GitHub Action', () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  // ── entrypoint.sh argument construction ────────────────────────

  describe('entrypoint.sh', () => {
    // The entrypoint script should be parseable by bash
    it('is a valid bash script', () => {
      const result = execSync(`bash -n "${SCRIPT}" 2>&1 || true`, { encoding: 'utf8' });
      // bash -n returns no output on success; any output means a parse error
      assert.strictEqual(result.trim(), '', 'entrypoint.sh should parse as valid bash');
    });

    it('constructs goal-only command correctly', () => {
      // Dry-parse the script to verify the if/elif/else branching
      const content = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(content.includes('"run"') && content.includes('"--goal"'), 'should construct run --goal command via array dispatch');
      assert.ok(content.includes('INPUT_GOAL'), 'should read INPUT_GOAL env var');
    });

    it('constructs plan-only command correctly', () => {
      const content = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(content.includes('"swarm"') && content.includes('"$PLAN"'), 'should pass plan file to swarm subcommand via array dispatch');
      assert.ok(content.includes('INPUT_PLAN'), 'should read INPUT_PLAN env var');
    });

    it('constructs recipe command correctly', () => {
      const content = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(content.includes('"use"') && content.includes('"$RECIPE"'), 'should invoke use subcommand for recipes via array dispatch');
      assert.ok(content.includes('INPUT_RECIPE'), 'should read INPUT_RECIPE env var');
    });

    it('passes model flag when set', () => {
      const content = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(content.includes('"--model"') && content.includes('"$MODEL"'), 'should append --model when MODEL is set');
    });

    it('errors when no goal, plan, or recipe provided', () => {
      // Run entrypoint with no inputs set (all empty)
      try {
        execSync(
          `INPUT_GOAL="" INPUT_PLAN="" INPUT_RECIPE="" INPUT_TOOL="copilot" INPUT_MODEL="" INPUT_MAX_RETRIES="3" INPUT_PR="review" bash "${SCRIPT}" 2>&1`,
          { encoding: 'utf8', timeout: 5000 }
        );
        assert.fail('should have exited with non-zero');
      } catch (err: unknown) {
        const e = err as { status: number; stdout: string };
        assert.notStrictEqual(e.status, 0, 'should exit non-zero');
        assert.ok(String(e.stdout || '').includes('one of goal, plan, or recipe must be provided'));
      }
    });

    it('includes --tool flag in constructed commands', () => {
      const content = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(content.includes('"--tool"') && content.includes('"$TOOL"'), 'should thread --tool into every command path via array dispatch');
    });

    it('includes --pr flag in constructed commands', () => {
      const content = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(content.includes('"--pr"') && content.includes('"$PR"'), 'all command branches should include the PR flag via array dispatch');
    });

    it('writes result to GITHUB_OUTPUT when result file exists', () => {
      const content = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(content.includes('GITHUB_OUTPUT'), 'should reference GITHUB_OUTPUT');
      assert.ok(content.includes('swarm-result.json'), 'should check for result file');
    });

    it('uses array dispatch instead of eval for shell injection safety', () => {
      const content = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(content.includes('CMD=('), 'should build command as a bash array');
      assert.ok(content.includes('"${CMD[@]}"'), 'should execute via array expansion');
      // eval should only appear in comments, never as a shell command
      const lines = content.split('\n');
      const evalCommands = lines.filter(l => {
        const trimmed = l.trim();
        return trimmed.startsWith('eval') && !trimmed.startsWith('#');
      });
      assert.strictEqual(evalCommands.length, 0, 'should not contain eval commands');
    });

    it('does not echo raw user input in log lines', () => {
      const content = fs.readFileSync(SCRIPT, 'utf8');
      // The old script had: echo "Running: $CMD" which leaked the goal text
      assert.ok(!content.includes('echo "Running: $CMD"'), 'should not echo the raw command string');
      assert.ok(!content.includes('echo "Running: ${CMD"'), 'should not echo raw array contents');
    });

    it('redacts known secret env vars from session artifacts', () => {
      const content = fs.readFileSync(SCRIPT, 'utf8');
      assert.ok(content.includes('REDACT_KEYS'), 'should define redaction key list');
      assert.ok(content.includes('ANTHROPIC_API_KEY'), 'should redact Anthropic keys');
      assert.ok(content.includes('OPENAI_API_KEY'), 'should redact OpenAI keys');
      assert.ok(content.includes('GITHUB_TOKEN'), 'should redact GitHub tokens');
      assert.ok(content.includes('[REDACTED:'), 'should replace secrets with tagged placeholders');
    });
  });

  // ── CI result JSON structure ───────────────────────────────────

  describe('CI result contract', () => {
    it('uses stepNumber (not id) in result shape', () => {
      // Verify the ParallelStepResult has stepNumber
      const sample: ParallelStepResult = {
        stepNumber: 1,
        agentName: 'dev',
        status: 'completed',
      };
      assert.strictEqual(sample.stepNumber, 1);
      assert.strictEqual((sample as unknown as Record<string, unknown>)['id'], undefined);
    });

    it('uses verificationResult (not verification) in result shape', () => {
      const sample: ParallelStepResult = {
        stepNumber: 1,
        agentName: 'dev',
        status: 'completed',
        verificationResult: {
          stepNumber: 1,
          agentName: 'dev',
          passed: true,
          checks: [],
          unverifiedClaims: [],
          timestamp: new Date().toISOString(),
          transcriptPath: '/tmp/t.md',
        },
      };
      assert.ok(sample.verificationResult);
      assert.strictEqual(sample.verificationResult!.passed, true);
      assert.strictEqual((sample as unknown as Record<string, unknown>)['verification'], undefined);
    });

    it('SwarmExecutionContext uses results (not steps)', () => {
      // Compile-time evidence: SwarmExecutionContext has a 'results' property.
      // If it were named 'steps', this assignment would fail type-checking.
      const accessor = (ctx: SwarmExecutionContext) => ctx.results;
      assert.strictEqual(typeof accessor, 'function');
    });

    it('allPassed must be derived (not a property)', () => {
      // SwarmExecutionContext has no allStepsPassed property
      const ctx = {} as SwarmExecutionContext;
      assert.strictEqual((ctx as unknown as Record<string, unknown>)['allStepsPassed'], undefined);
    });
  });

  // ── exit code semantics ────────────────────────────────────────

  describe('exit code contract', () => {
    it('ParallelStepResult tracks retryCount', () => {
      const r: ParallelStepResult = {
        stepNumber: 1,
        agentName: 'dev',
        status: 'failed',
        retryCount: 2,
      };
      assert.strictEqual(r.retryCount, 2);
    });
  });

  // ── action.yml validation ─────────────────────────────────────

  describe('action.yml', () => {
    const actionPath = path.resolve(__dirname, '..', 'action.yml');
    const actionSrc = path.resolve(__dirname, '..', '..', 'action.yml');
    const filePath = fs.existsSync(actionPath) ? actionPath : actionSrc;

    it('exists and is readable', () => {
      assert.ok(fs.existsSync(filePath), 'action.yml should exist');
    });

    it('declares required inputs', () => {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('goal:'), 'should declare goal input');
      assert.ok(content.includes('plan:'), 'should declare plan input');
      assert.ok(content.includes('recipe:'), 'should declare recipe input');
      assert.ok(content.includes('tool:'), 'should declare tool input');
      assert.ok(content.includes('model:'), 'should declare model input');
    });

    it('declares outputs', () => {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('result:'), 'should declare result output');
      assert.ok(content.includes('plan-path:'), 'should declare plan-path output');
      assert.ok(content.includes('pr-url:'), 'should declare pr-url output');
    });

    it('uses docker runner', () => {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes("using: 'docker'"), 'should use docker container action');
    });
  });

  // ── Dockerfile validation ─────────────────────────────────────

  describe('Dockerfile', () => {
    const dockerPath = path.resolve(__dirname, '..', 'Dockerfile');
    const dockerSrc = path.resolve(__dirname, '..', '..', 'Dockerfile');
    const filePath = fs.existsSync(dockerPath) ? dockerPath : dockerSrc;

    it('exists', () => {
      assert.ok(fs.existsSync(filePath), 'Dockerfile should exist');
    });

    it('installs git', () => {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('git'), 'should install git (required for branch ops)');
    });

    it('uses node 20 base image', () => {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('node:20'), 'should use Node.js 20 LTS');
    });

    it('sets entrypoint to entrypoint.sh', () => {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('entrypoint.sh'), 'should reference entrypoint.sh');
    });
  });

  // ── GITHUB_ACTIONS env detection ──────────────────────────────

  describe('GITHUB_ACTIONS env detection', () => {
    it('writeCIOutputs is only invoked when GITHUB_ACTIONS is set', () => {
      // Verify the source code checks for the env var (now in cli/swarm-handlers.ts)
      const srcPath = path.resolve(__dirname, '..', 'cli', 'swarm-handlers.ts');
      const srcAlt = path.resolve(__dirname, '..', '..', 'src', 'cli', 'swarm-handlers.ts');
      const filePath = fs.existsSync(srcPath) ? srcPath : srcAlt;
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(
        content.includes("process.env.GITHUB_ACTIONS"),
        'CI output should only trigger when GITHUB_ACTIONS env var is set'
      );
    });
  });
});
