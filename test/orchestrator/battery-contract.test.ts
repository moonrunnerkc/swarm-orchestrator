import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runEndOfRunBattery } from '../../src/orchestrator/end-of-run-battery';
import type { BatteryCommandRunner } from '../../src/verification/battery-runner';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_TERMINAL_PROMPT: '0',
};

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: GIT_ENV,
  }).trim();
}

function write(root: string, rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

interface Repo {
  root: string;
  baseCommit: string;
  patchCommit: string;
}

function makeRepo(): Repo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-test-'));
  git(root, ['init', '-b', 'main']);
  write(root, 'src/add.js', 'function add(a,b){return a-b;} module.exports={add};\n');
  write(root, 'test.js', "const{add}=require('./src/add');if(add(2,3)!==5)throw new Error('wrong');\n");
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);

  write(root, 'src/add.js', 'function add(a,b){return a+b;} module.exports={add};\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fix add']);
  const patchCommit = git(root, ['rev-parse', 'HEAD']);
  return { root, baseCommit, patchCommit };
}

function makeRunner(exitCode: number, stdout = ''): BatteryCommandRunner {
  return async (command, cwd) => ({
    command,
    cwd,
    exitCode,
    stdout,
    stderr: '',
    durationMs: 1,
    timedOut: false,
  });
}

const passRunner = makeRunner(0, 'total mutants: 3\nkilled mutants: 3\nsurvived mutants: 0\nmutation score 100%');
const failRunner = makeRunner(1);

function makePlan(goal = 'fix add function') {
  return {
    goal,
    steps: [],
    parallelExecutionStrategy: 'wave' as const,
    executionMode: 'single-agent' as const,
    estimatedDuration: 0,
    complexity: 'simple' as const,
    createdAt: new Date().toISOString(),
  };
}

describe('battery contract: no-bypass semantics', () => {
  const repos: string[] = [];

  afterEach(() => {
    for (const r of repos) fs.rmSync(r, { recursive: true, force: true });
    repos.length = 0;
  });

  it('hardGatePassed false when differential command is absent and no runner supplied', async () => {
    const repo = makeRepo();
    repos.push(repo.root);
    const result = await runEndOfRunBattery({
      workingDir: repo.root,
      plan: makePlan(),
      context: { baselineSnapshot: { headCommit: repo.baseCommit } },
      options: {
        // no differentialTestCommand — Layer 1 fails closed
        regressionCommandRunner: passRunner,
        mutationCommandRunner: passRunner,
        propertyCommandRunner: passRunner,
      },
    });
    assert.equal(result.hardGatePassed, false, 'missing differential command must fail hard gate');
    assert.ok(
      result.failedHardLayers.includes('differential-gate'),
      `expected differential-gate in failedHardLayers, got: ${result.failedHardLayers.join(', ')}`,
    );
  });

  it('hardGatePassed true when differential passes and regression passes', async () => {
    const repo = makeRepo();
    repos.push(repo.root);
    const diffCmd = 'node test.js';
    const result = await runEndOfRunBattery({
      workingDir: repo.root,
      plan: makePlan(),
      context: { baselineSnapshot: { headCommit: repo.baseCommit } },
      options: {
        differentialTestCommand: diffCmd,
        regressionCommandRunner: passRunner,
        mutationCommandRunner: passRunner,
        propertyCommandRunner: passRunner,
      },
    });
    assert.equal(result.hardGatePassed, true, 'differential + regression pass must satisfy hard gate');
    assert.deepEqual(result.failedHardLayers, [], 'no hard layers should fail');
  });

  it('hardGatePassed true, advisoryWarningLayers non-empty when only advisory layers fail', async () => {
    const repo = makeRepo();
    repos.push(repo.root);
    const result = await runEndOfRunBattery({
      workingDir: repo.root,
      plan: makePlan(),
      context: { baselineSnapshot: { headCommit: repo.baseCommit } },
      options: {
        differentialTestCommand: 'node test.js',
        regressionCommandRunner: passRunner,
        mutationCommandRunner: passRunner,
        // property runner fails — advisory only
        propertyCommandRunner: failRunner,
      },
    });
    assert.equal(result.hardGatePassed, true, 'property failure must not block hard gate');
    assert.deepEqual(result.failedHardLayers, [], 'no hard layers should fail');
    assert.ok(
      result.advisoryWarningLayers.length > 0,
      'property failure must appear in advisoryWarningLayers',
    );
  });

  it('hardGatePassed false and failedHardLayers non-empty when regression runner fails', async () => {
    const repo = makeRepo();
    repos.push(repo.root);
    const result = await runEndOfRunBattery({
      workingDir: repo.root,
      plan: makePlan(),
      context: { baselineSnapshot: { headCommit: repo.baseCommit } },
      options: {
        differentialTestCommand: 'node test.js',
        regressionCommandRunner: failRunner,
        mutationCommandRunner: failRunner,
        propertyCommandRunner: passRunner,
      },
    });
    assert.equal(result.hardGatePassed, false, 'regression failure must block hard gate');
    assert.ok(
      result.failedHardLayers.length > 0,
      'regression failure must populate failedHardLayers',
    );
  });

  it('failedHardLayers and advisoryWarningLayers are mutually exclusive', async () => {
    const repo = makeRepo();
    repos.push(repo.root);
    // Mix: differential fails (hard), property fails (advisory)
    const result = await runEndOfRunBattery({
      workingDir: repo.root,
      plan: makePlan(),
      context: { baselineSnapshot: { headCommit: repo.baseCommit } },
      options: {
        // no differentialTestCommand — hard fail
        regressionCommandRunner: passRunner,
        mutationCommandRunner: passRunner,
        propertyCommandRunner: failRunner,
      },
    });
    const overlap = result.failedHardLayers.filter((l) => result.advisoryWarningLayers.includes(l));
    assert.deepEqual(overlap, [], 'no layer should appear in both failedHardLayers and advisoryWarningLayers');
  });
});
