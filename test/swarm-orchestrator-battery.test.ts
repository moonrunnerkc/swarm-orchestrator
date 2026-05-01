import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runEndOfRunBattery,
  summarizeProductionStepRoles,
} from '../src/orchestrator/end-of-run-battery';
import type { ExecutionPlan } from '../src/plan-generator';
import type { BatteryCommandRunner } from '../src/verification';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
};

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: GIT_ENV,
  }).trim();
}

function writeFile(root: string, rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

function makePlan(): ExecutionPlan {
  return {
    goal: 'Fix add',
    createdAt: '2026-05-01T00:00:00.000Z',
    steps: [
      {
        stepNumber: 1,
        agentName: 'worker',
        task: 'Fix add implementation',
        dependencies: [],
        expectedOutputs: ['src/calc.js'],
      },
      {
        stepNumber: 2,
        agentName: 'reviewer',
        task: 'Review fix',
        dependencies: [1],
        expectedOutputs: ['review notes'],
      },
    ],
    metadata: { totalSteps: 2 },
  };
}

const passingRunner: BatteryCommandRunner = async (command, cwd) => ({
  command,
  cwd,
  exitCode: 0,
  stdout: 'total mutants: 1\nkilled mutants: 1\nsurvived mutants: 0\nmutation score 100%',
  stderr: '',
  durationMs: 1,
  timedOut: false,
});

describe('end-of-run battery production hook helpers', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-battery-hook-'));
    git(root, ['init', '-b', 'main']);
    writeFile(root, 'src/calc.js', [
      'function add(a, b) { return a - b; }',
      'module.exports = { add };',
      '',
    ].join('\n'));
    writeFile(root, 'test.js', [
      "const { add } = require('./src/calc');",
      'if (add(2, 3) !== 5) throw new Error("bad add");',
      '',
    ].join('\n'));
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'base']);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('summarizes worker and reviewer roles from production PlanStep agent names', () => {
    const summary = summarizeProductionStepRoles(makePlan());

    assert.deepEqual(summary.workerSteps, [1]);
    assert.deepEqual(summary.reviewerSteps, [2]);
    assert.deepEqual(summary.otherSteps, []);
    assert.match(summary.hookPoint, /after scheduler completion/);
  });

  it('runs the battery from the production end-of-run context', async () => {
    const baseCommit = git(root, ['rev-parse', 'HEAD']);
    writeFile(root, 'src/calc.js', [
      'function add(a, b) { return a + b; }',
      'module.exports = { add };',
      '',
    ].join('\n'));
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'fix add']);

    const result = await runEndOfRunBattery({
      workingDir: root,
      plan: makePlan(),
      context: { baselineSnapshot: { headCommit: baseCommit } },
      options: {
        differentialTestCommand: 'node test.js',
        regressionCommand: 'node test.js',
        mutationCommandRunner: passingRunner,
        propertyCommandRunner: passingRunner,
      },
    });

    assert.equal(result.layerResults.length, 5);
    assert.equal(result.hardGatePassed, true);
    assert.equal(result.layerResults[0].layer, 'differential-gate');
  });
});
