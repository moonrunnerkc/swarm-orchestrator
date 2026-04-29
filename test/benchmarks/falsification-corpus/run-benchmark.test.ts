import { execFileSync } from 'child_process';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runBenchmark } from '../../../benchmarks/falsification-corpus/cli/run-benchmark';
import { writeLabel } from '../../../benchmarks/falsification-corpus/label-store';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Benchmark Runner Test',
  GIT_AUTHOR_EMAIL: 'benchmark-runner@example.test',
  GIT_COMMITTER_NAME: 'Benchmark Runner Test',
  GIT_COMMITTER_EMAIL: 'benchmark-runner@example.test',
};

describe('falsification run-benchmark CLI core', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falsification-runner-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs a labeled real-patch corpus and writes draft reports under n ten', async () => {
    const fixture = createFixture(tmpDir);
    await writeLabel(fixture.labelsDir, fixture.entryId, {
      verdict: 'clean',
      rationale: 'The patch changes the message file to the requested value. It satisfies the goal and keeps the regression check passing. The diff evidence is a one-line message change with no test fixture edits.',
      labeledBy: 'runner-test',
      labeledAt: '2026-04-29T00:00:00.000Z',
    });
    write(path.join(fixture.testSpecDir, `${fixture.entryId}.test-spec.json`), JSON.stringify({
      testCommand: 'node intent.test.js',
      regressionCommand: 'node regression.test.js',
    }));

    const summary = await runBenchmark({
      corpusDir: fixture.corpusRoot,
      labelsDir: fixture.labelsDir,
      outputDir: fixture.outputDir,
      testSpecDir: fixture.testSpecDir,
    });
    const report = JSON.parse(fs.readFileSync(summary.reportJsonPath, 'utf8')) as { draft: boolean; metrics: { n: number } };
    const markdown = fs.readFileSync(summary.reportMarkdownPath, 'utf8');

    assert.equal(summary.records, 1);
    assert.equal(summary.draft, true);
    assert.equal(report.draft, true);
    assert.equal(report.metrics.n, 1);
    assert.equal(fs.existsSync(path.join(summary.perEntryDir, `${fixture.entryId}.json`)), true);
    assert.match(markdown, /DRAFT/);
  });
});

function createFixture(rootDir: string): {
  corpusRoot: string;
  labelsDir: string;
  outputDir: string;
  testSpecDir: string;
  entryId: string;
} {
  const corpusRoot = path.join(rootDir, 'verification-runs');
  const repoPath = path.join(corpusRoot, 'target', 'sample');
  fs.mkdirSync(repoPath, { recursive: true });
  git(repoPath, ['init', '-b', 'main']);
  write(path.join(repoPath, 'package.json'), JSON.stringify({ scripts: { test: 'node regression.test.js' } }));
  write(path.join(repoPath, 'message.txt'), 'old\n');
  write(path.join(repoPath, 'intent.test.js'), [
    "const assert = require('assert');",
    "const fs = require('fs');",
    "assert.equal(fs.readFileSync('message.txt', 'utf8').trim(), 'new');",
    '',
  ].join('\n'));
  write(path.join(repoPath, 'regression.test.js'), "const assert = require('assert');\nassert.equal(1, 1);\n");
  commitAll(repoPath, 'base');
  const branchName = 'swarm/swarm-2026-04-29T00-00-00-001Z/step-1-worker';
  git(repoPath, ['switch', '-c', branchName]);
  write(path.join(repoPath, 'message.txt'), 'new\n');
  commitAll(repoPath, 'agent patch');
  git(repoPath, ['switch', 'main']);

  const runDir = path.join(repoPath, 'runs', 'swarm-2026-04-29T00-00-00-000Z');
  const sharePath = path.join(runDir, 'steps', 'step-1', 'share.md');
  writeRunMetadata(runDir, sharePath, branchName);
  git(repoPath, ['merge', '--no-ff', branchName, '-m', `Merge ${branchName}`]);

  return {
    corpusRoot,
    labelsDir: path.join(rootDir, 'labels'),
    outputDir: path.join(rootDir, 'out', 'run-1'),
    testSpecDir: path.join(rootDir, 'specs'),
    entryId: 'round1-sample-step-1',
  };
}

function writeRunMetadata(runDir: string, sharePath: string, branchName: string): void {
  write(path.join(runDir, 'session-state.json'), JSON.stringify({
    graph: { goal: 'Change message.txt to new.', steps: [{ stepNumber: 1 }] },
    branchMap: { '1': branchName },
    transcripts: { '1': sharePath },
  }));
  write(path.join(runDir, 'metrics.json'), JSON.stringify({ executionId: 'swarm-2026-04-29T00-00-00-001Z' }));
  write(path.join(runDir, 'cost-attribution.json'), JSON.stringify({ modelUsed: 'gpt-5.4' }));
  write(sharePath, '# Agent Session Transcript\nChanged message.txt.\n');
  write(path.join(runDir, 'verification', 'step-1-verification.md'), '# Verification Report\n');
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: GIT_ENV,
  }).trim();
}

function commitAll(repoPath: string, message: string): void {
  git(repoPath, ['add', '.']);
  git(repoPath, ['commit', '-m', message]);
}
