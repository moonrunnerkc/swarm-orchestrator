import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  fixturePrContext,
  fixturePrDiff,
  fixtureRepoUrl,
  loadPrFixtureManifest,
  type PrFixtureManifest,
} from '../../src/audit/pr-fixture';

// The local PR-fixture seam is FAIL-CLOSED: inert unless SWARM_PR_FIXTURE_DIR is
// set. These tests pin both directions (inert in production, active with a
// fixture) and the repo-name guard on the clone-URL override.

const tempDirs: string[] = [];
const savedEnv = process.env.SWARM_PR_FIXTURE_DIR;

function fixture(manifest: Partial<PrFixtureManifest> = {}, diff = 'DIFF'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-fixture-'));
  tempDirs.push(dir);
  const full: PrFixtureManifest = {
    repo: 'owner/name',
    number: 1,
    title: 'fix the thing',
    body: 'closes #1',
    author: 'someone',
    headRef: 'pr',
    headSha: 'h'.repeat(40),
    baseSha: 'b'.repeat(40),
    commitMessages: ['fix the thing'],
    ...manifest,
  };
  fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify(full));
  fs.writeFileSync(path.join(dir, full.diffPath ?? 'pr.diff'), diff);
  fs.mkdirSync(path.join(dir, full.repoPath ?? 'repo'), { recursive: true });
  return dir;
}

afterEach(() => {
  if (savedEnv === undefined) delete process.env.SWARM_PR_FIXTURE_DIR;
  else process.env.SWARM_PR_FIXTURE_DIR = savedEnv;
});

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('audit / pr-fixture seam', () => {
  it('is inert when SWARM_PR_FIXTURE_DIR is unset (production)', () => {
    delete process.env.SWARM_PR_FIXTURE_DIR;
    assert.equal(loadPrFixtureManifest(), null);
    assert.equal(fixturePrDiff(), null);
    assert.equal(fixturePrContext(), null);
    assert.equal(fixtureRepoUrl('owner/name'), null);
  });

  it('reads the diff and context from a configured fixture', () => {
    const dir = fixture({}, 'the-diff');
    process.env.SWARM_PR_FIXTURE_DIR = dir;
    assert.equal(fixturePrDiff(), 'the-diff');
    const ctx = fixturePrContext();
    assert.equal(ctx?.prMetadata.repository, 'owner/name');
    assert.equal(ctx?.prMetadata.headSha, 'h'.repeat(40));
    assert.equal(ctx?.prMetadata.title, 'fix the thing');
    assert.equal(ctx?.fingerprintInput.authors[0], 'someone');
  });

  it('returns the local repo URL only when the repo name matches', () => {
    const dir = fixture({ repo: 'owner/name' });
    process.env.SWARM_PR_FIXTURE_DIR = dir;
    assert.equal(fixtureRepoUrl('owner/name'), path.resolve(dir, 'repo'));
    assert.equal(fixtureRepoUrl('someone/else'), null, 'non-matching repo falls through to GitHub');
  });

  it('throws loudly when the env is set but the manifest is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-fixture-empty-'));
    tempDirs.push(dir);
    process.env.SWARM_PR_FIXTURE_DIR = dir;
    assert.throws(() => loadPrFixtureManifest(), /fixture\.json does not exist/);
  });
});
