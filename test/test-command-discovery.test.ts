import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverTestCommand, renderVerifyCommandSection } from '../src/test-command-discovery';
import SessionExecutor from '../src/session-executor';
import { StepRunner } from '../src/step-runner';
import RepairAgent, { RepairContext } from '../src/repair-agent';
import { buildSwarmPrompt, writeSharedInstructions } from '../src/prompt-builder';

/**
 * Regression coverage for the "agent runs `npx vitest --run` instead of the
 * project's full test gate" bug. Locks down the discovery utility and
 * confirms every prompt-building path in the orchestrator injects the
 * project's discovered `<pm> test` command.
 */
describe('test command discovery + prompt injection', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testcmd-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function writePackageJson(contents: Record<string, unknown>): void {
    fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify(contents, null, 2), 'utf8');
  }

  function usePnpmTarget(): void {
    writePackageJson({ scripts: { test: 'pnpm lint && vitest --run --coverage && pnpm test:types' } });
    fs.writeFileSync(path.join(projectRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 6', 'utf8');
  }

  describe('discoverTestCommand', () => {
    it('detects pnpm from pnpm-lock.yaml and reads scripts.test', () => {
      usePnpmTarget();
      const result = discoverTestCommand(projectRoot);
      assert.strictEqual(result.command, 'pnpm test');
      assert.strictEqual(result.packageManager, 'pnpm');
      assert.strictEqual(result.hasScript, true);
      assert.strictEqual(result.rawScript, 'pnpm lint && vitest --run --coverage && pnpm test:types');
      assert.strictEqual(result.warning, undefined);
    });

    it('detects yarn from yarn.lock', () => {
      writePackageJson({ scripts: { test: 'jest' } });
      fs.writeFileSync(path.join(projectRoot, 'yarn.lock'), '# yarn lockfile v1', 'utf8');
      const result = discoverTestCommand(projectRoot);
      assert.strictEqual(result.command, 'yarn test');
      assert.strictEqual(result.packageManager, 'yarn');
    });

    it('defaults to npm when no lockfile is present', () => {
      writePackageJson({ scripts: { test: 'mocha' } });
      const result = discoverTestCommand(projectRoot);
      assert.strictEqual(result.command, 'npm test');
      assert.strictEqual(result.packageManager, 'npm');
    });

    it('warns and falls back when package.json is missing', () => {
      const result = discoverTestCommand(projectRoot);
      assert.strictEqual(result.command, 'npm test');
      assert.strictEqual(result.hasScript, false);
      assert.ok(result.warning && result.warning.includes('no package.json'));
    });

    it('warns and falls back when scripts.test is missing', () => {
      writePackageJson({ name: 'demo', scripts: { build: 'tsc' } });
      const result = discoverTestCommand(projectRoot);
      assert.strictEqual(result.command, 'npm test');
      assert.strictEqual(result.hasScript, false);
      assert.ok(result.warning && result.warning.includes('no "test" script'));
    });

    it('warns and falls back when package.json is malformed', () => {
      fs.writeFileSync(path.join(projectRoot, 'package.json'), '{ not valid json', 'utf8');
      const result = discoverTestCommand(projectRoot);
      assert.strictEqual(result.hasScript, false);
      assert.ok(result.warning && result.warning.includes('failed to parse'));
    });
  });

  describe('renderVerifyCommandSection', () => {
    it('uses the exact wording required by the orchestrator contract', () => {
      const section = renderVerifyCommandSection({
        command: 'pnpm test',
        rawScript: 'pnpm lint && vitest --run --coverage && pnpm test:types',
        hasScript: true,
        packageManager: 'pnpm',
        warning: undefined,
      });
      assert.ok(section.includes('Before committing, run `pnpm test` and verify it passes.'));
      assert.ok(section.includes('Do not run individual test tools directly.'));
      assert.ok(section.includes("Run the project's full test script."));
      assert.ok(section.includes('pnpm lint && vitest --run --coverage && pnpm test:types'));
    });

    it('surfaces the fallback warning when no test script exists', () => {
      const section = renderVerifyCommandSection({
        command: 'npm test',
        rawScript: undefined,
        hasScript: false,
        packageManager: 'npm',
        warning: 'no "test" script in /tmp/foo/package.json; falling back to "npm test" (may fail if no test setup exists)',
      });
      assert.ok(section.includes('WARNING:'));
      assert.ok(section.includes('no "test" script'));
    });
  });

  describe('prompt injection', () => {
    const step = {
      stepNumber: 1,
      task: 'Add auth',
      agentName: 'worker',
      dependencies: [],
      expectedOutputs: ['src/auth.ts'],
    };
    const agent = {
      name: 'worker',
      purpose: 'Backend',
      scope: ['Backend code'],
      boundaries: ['No frontend'],
      done_definition: ['Tests pass'],
      refusal_rules: ['No invented APIs'],
      output_contract: {
        transcript: 'proof/step-{N}-backend.md',
        artifacts: [],
      },
    };

    function makePlan() {
      return {
        goal: 'Build auth',
        createdAt: new Date().toISOString(),
        steps: [step],
      };
    }

    function makeExecContext() {
      return {
        plan: makePlan(),
        planFilename: 'plan.json',
        executionId: 'exec-1',
        startTime: new Date().toISOString(),
        currentStep: 0,
        stepResults: [],
        priorContext: [],
      };
    }

    beforeEach(() => {
      usePnpmTarget();
    });

    it('SessionExecutor.buildStepPrompt injects the discovered pnpm test command', () => {
      const executor = new SessionExecutor(projectRoot);
      // Private method access: same pattern used by session-executor.test.ts
      // for buildStepPrompt coverage.
      const prompt = (executor as unknown as {
        buildStepPrompt: (s: typeof step, a: typeof agent, c: ReturnType<typeof makeExecContext>) => string;
      }).buildStepPrompt(step, agent, makeExecContext());

      assert.ok(prompt.includes('Before committing, run `pnpm test` and verify it passes.'));
      assert.ok(prompt.includes("Run the project's full test script."));
      assert.ok(prompt.includes('pnpm lint && vitest --run --coverage && pnpm test:types'));
      assert.ok(prompt.includes('Do not run individual test tools directly.'));
    });

    it('StepRunner.generateSessionPrompt injects the discovered pnpm test command', () => {
      const runner = new StepRunner(path.join(projectRoot, 'proof'), projectRoot);
      const prompt = runner.generateSessionPrompt(step, agent, makeExecContext());
      assert.ok(prompt.includes('Before committing, run `pnpm test` and verify it passes.'));
      assert.ok(prompt.includes("Run the project's full test script."));
      assert.ok(prompt.includes('pnpm lint && vitest --run --coverage && pnpm test:types'));
    });

    it('prompt-builder.buildSwarmPrompt injects the discovered pnpm test command', () => {
      const prompt = buildSwarmPrompt(
        step,
        agent,
        { plan: makePlan(), targetProjectRoot: projectRoot },
        'no dependencies',
      );
      assert.ok(prompt.includes('Before committing, run `pnpm test` and verify it passes.'));
      assert.ok(prompt.includes("Run the project's full test script."));
      assert.ok(prompt.includes('pnpm lint && vitest --run --coverage && pnpm test:types'));
      // Ensure the old vague sentence was replaced
      assert.ok(!prompt.includes('Run tests if applicable.'), 'should no longer say "Run tests if applicable"');
    });

    it('RepairAgent.buildRepairPrompt injects the discovered pnpm test command', () => {
      const repair = new RepairAgent(projectRoot);
      const ctx: RepairContext = {
        stepNumber: 1,
        agentName: 'TestAgent',
        originalTask: 'Fix auth',
        transcriptPath: path.join(projectRoot, 'share.md'),
        verificationReportPath: path.join(projectRoot, 'verify.md'),
        branchName: 'swarm/test/step-1',
        failedChecks: ['[test] tests failed'],
        rootCause: 'tests not run',
        retryCount: 1,
      };
      const prompt = repair.buildRepairPrompt(ctx);
      assert.ok(prompt.includes('Before committing, run `pnpm test` and verify it passes.'));
      assert.ok(prompt.includes("Run the project's full test script."));
    });

    it('writeSharedInstructions pins the discovered pnpm test command into .copilot-instructions.md', () => {
      writeSharedInstructions(projectRoot);
      const out = fs.readFileSync(path.join(projectRoot, '.copilot-instructions.md'), 'utf8');
      assert.ok(out.includes('## Verify Before Committing'));
      assert.ok(out.includes('Before committing, run `pnpm test` and verify it passes.'));
      assert.ok(out.includes('pnpm lint && vitest --run --coverage && pnpm test:types'));
    });

    it('falls back to npm test with a warning when the target has no test script', () => {
      fs.rmSync(path.join(projectRoot, 'pnpm-lock.yaml'), { force: true });
      fs.rmSync(path.join(projectRoot, 'package.json'), { force: true });

      const executor = new SessionExecutor(projectRoot);
      const prompt = (executor as unknown as {
        buildStepPrompt: (s: typeof step, a: typeof agent, c: ReturnType<typeof makeExecContext>) => string;
      }).buildStepPrompt(step, agent, makeExecContext());

      assert.ok(prompt.includes('Before committing, run `npm test` and verify it passes.'));
      assert.ok(prompt.includes('WARNING:'));
    });
  });
});
