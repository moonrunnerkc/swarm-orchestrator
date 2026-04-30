import { execFileSync } from 'child_process';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CorpusLoaderError, loadCorpus } from '../../../benchmarks/falsification-corpus/loader';

interface Fixture {
  corpusRoot: string;
  repoPath: string;
  runDir: string;
  sharePath: string;
  baseCommit: string;
  mergeCommit: string;
}

describe('falsification corpus loader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falsification-corpus-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads verification-run entries from real git branch merges', async () => {
    const fixture = createVerificationRunFixture();

    const entries = await loadCorpus(fixture.corpusRoot);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'round2-codex-slugify-step-1');
    assert.equal(entries[0].source, 'verification-run');
    assert.equal(entries[0].goalText, 'Fix the sample bug');
    assert.equal(entries[0].repoPath, fixture.repoPath);
    assert.equal(entries[0].baseCommit, fixture.baseCommit);
    assert.equal(entries[0].patchCommit, fixture.mergeCommit);
    assert.deepEqual(entries[0].agentIdentity, { cli: 'codex', model: 'gpt-5.4' });
    assert.equal(entries[0].transcriptPath, fixture.sharePath);
    assert.equal(entries[0].metadata.capturedAt, '2026-04-29T00:00:00.000Z');
    assert.equal(entries[0].metadata.runDir, fixture.runDir);
    assert.equal(entries[0].metadata.stepNumber, 1);
  });

  it('halts with actionable issues when expected step artifacts are missing', async () => {
    const fixture = createVerificationRunFixture({ omitVerification: true });

    await assert.rejects(
      () => loadCorpus(fixture.corpusRoot),
      (error: unknown) => {
        assert.ok(error instanceof CorpusLoaderError);
        assert.equal(error.issues.length, 1);
        assert.equal(error.issues[0].phase, 'step-1');
        assert.match(error.issues[0].reason, /missing verification report/);
        assert.match(error.message, /Restore verification\/step-N-verification\.md/);
        return true;
      },
    );
  });

  function createVerificationRunFixture(options: { omitVerification?: boolean } = {}): Fixture {
    const corpusRoot = path.join(tmpDir, 'verification-runs');
    const repoPath = path.join(corpusRoot, 'round-2-target', 'codex-slugify');
    const branchName = 'swarm/swarm-2026-04-29T00-00-00-001Z/step-1-worker';
    fs.mkdirSync(repoPath, { recursive: true });
    git(repoPath, ['init', '-b', 'master']);
    git(repoPath, ['config', 'user.name', 'Falsification Corpus Test']);
    git(repoPath, ['config', 'user.email', 'corpus-test@example.com']);
    write(path.join(repoPath, 'index.js'), 'module.exports = () => "old";\n');
    commitAll(repoPath, 'initial');
    git(repoPath, ['switch', '-c', branchName]);
    write(path.join(repoPath, 'index.js'), 'module.exports = () => "new";\n');
    commitAll(repoPath, 'fix sample bug');
    git(repoPath, ['switch', 'master']);

    const runDir = path.join(repoPath, 'runs', 'swarm-2026-04-29T00-00-00-000Z');
    const sharePath = path.join(runDir, 'steps', 'step-1', 'share.md');
    writeRunArtifacts(runDir, sharePath, branchName, options.omitVerification === true);
    git(repoPath, ['merge', '--no-ff', branchName, '-m', `Merge ${branchName}`]);

    const mergeCommit = git(repoPath, ['rev-parse', 'HEAD']);
    return {
      corpusRoot,
      repoPath,
      runDir,
      sharePath,
      baseCommit: git(repoPath, ['rev-parse', `${mergeCommit}^1`]),
      mergeCommit,
    };
  }

  function writeRunArtifacts(
    runDir: string,
    sharePath: string,
    branchName: string,
    omitVerification: boolean,
  ): void {
    write(path.join(runDir, 'session-state.json'), JSON.stringify({
      graph: { goal: 'Fix the sample bug', steps: [{ stepNumber: 1 }] },
      branchMap: { '1': branchName },
      transcripts: { '1': sharePath },
    }));
    write(path.join(runDir, 'metrics.json'), JSON.stringify({ executionId: 'swarm-2026-04-29T00-00-00-001Z' }));
    write(path.join(runDir, 'cost-attribution.json'), JSON.stringify({ modelUsed: 'gpt-5.4' }));
    write(sharePath, '# Agent Session Transcript\n');
    if (!omitVerification) {
      write(path.join(runDir, 'verification', 'step-1-verification.md'), '# Verification Report\n');
    }
  }
});

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitAll(repoPath: string, message: string): void {
  git(repoPath, ['add', '.']);
  git(repoPath, [
    '-c',
    'user.name=Falsification Corpus Test',
    '-c',
    'user.email=falsification-corpus@example.test',
    'commit',
    '-m',
    message,
  ]);
}
