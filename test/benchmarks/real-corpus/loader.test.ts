import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadPrCorpus,
  loadLabeledPrEntries,
  PrCorpusLoaderError,
} from '../../../benchmarks/real-corpus/loader';
import { writeLabel } from '../../../benchmarks/falsification-corpus/label-store';
import type {
  GroundTruthLabel,
  UnlabeledPrCorpusEntry,
} from '../../../benchmarks/real-corpus/schema';

const validEntryTemplate = (overrides: Partial<UnlabeledPrCorpusEntry>): UnlabeledPrCorpusEntry => ({
  id: 'claude-code-anthropics-claude-code-pr1',
  agent: { vendor: 'claude-code', confidence: 'high', source: 'body+branch' },
  pr: {
    number: 1,
    headSha: 'abc',
    baseSha: 'def',
    headRef: 'claude/x',
    title: 't',
    body: 'b',
    author: 'someone',
    repository: 'anthropics/claude-code',
  },
  diffRef: { repository: 'anthropics/claude-code', headSha: 'abc', baseSha: 'def' },
  vendoredDiffPath: 'claude-code/x.diff',
  vendoredAt: '2026-05-23T10:00:00.000Z',
  collectedAt: '2026-05-23T10:00:00.000Z',
  ...overrides,
});

function writeEntry(rawDir: string, vendor: string, entry: UnlabeledPrCorpusEntry): void {
  const dir = path.join(rawDir, vendor);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${entry.id}.json`), `${JSON.stringify(entry, null, 2)}\n`);
}

describe('real-corpus loader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-corpus-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty array when raw dir does not exist', async () => {
    const out = await loadPrCorpus(path.join(tmpDir, 'missing'));
    assert.deepEqual(out, []);
  });

  it('returns an empty array when raw dir exists but is empty', async () => {
    const rawDir = path.join(tmpDir, 'raw');
    fs.mkdirSync(rawDir);
    assert.deepEqual(await loadPrCorpus(rawDir), []);
  });

  it('loads entries from vendor subdirectories and sorts by id', async () => {
    const rawDir = path.join(tmpDir, 'raw');
    writeEntry(rawDir, 'claude-code', validEntryTemplate({ id: 'b-id' }));
    writeEntry(rawDir, 'devin', validEntryTemplate({
      id: 'a-id',
      agent: { vendor: 'devin', confidence: 'high', source: 'author+body' },
      pr: { ...validEntryTemplate({}).pr, number: 2, repository: 'someone/somewhere' },
    }));
    const out = await loadPrCorpus(rawDir);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.id, 'a-id');
    assert.equal(out[1]?.id, 'b-id');
  });

  it('skips dotfiles and non-JSON files', async () => {
    const rawDir = path.join(tmpDir, 'raw');
    writeEntry(rawDir, 'claude-code', validEntryTemplate({}));
    fs.writeFileSync(path.join(rawDir, 'claude-code', '.DS_Store'), 'noise');
    fs.writeFileSync(path.join(rawDir, 'claude-code', 'sample.diff'), 'patch text');
    const out = await loadPrCorpus(rawDir);
    assert.equal(out.length, 1);
  });

  it('raises PrCorpusLoaderError with structural issues on malformed JSON', async () => {
    const rawDir = path.join(tmpDir, 'raw');
    fs.mkdirSync(path.join(rawDir, 'claude-code'), { recursive: true });
    fs.writeFileSync(path.join(rawDir, 'claude-code', 'broken.json'), '{ not json');
    await assert.rejects(
      () => loadPrCorpus(rawDir),
      (err: unknown) => {
        assert.ok(err instanceof PrCorpusLoaderError);
        assert.equal(err.issues.length, 1);
        assert.match(err.issues[0]!.reason, /invalid JSON/);
        return true;
      },
    );
  });

  it('detects duplicate {repository, pr#} keys across vendor dirs', async () => {
    const rawDir = path.join(tmpDir, 'raw');
    const dup = validEntryTemplate({});
    writeEntry(rawDir, 'claude-code', dup);
    writeEntry(rawDir, 'cursor', { ...dup, id: 'cursor-anthropics-claude-code-pr1' });
    await assert.rejects(
      () => loadPrCorpus(rawDir),
      (err: unknown) => {
        assert.ok(err instanceof PrCorpusLoaderError);
        assert.ok(err.issues.some((i) => i.reason.includes('duplicate')));
        return true;
      },
    );
  });

  it('pairs entries with labels via loadLabeledPrEntries', async () => {
    const rawDir = path.join(tmpDir, 'raw');
    const labelsDir = path.join(tmpDir, 'labels');
    const entry = validEntryTemplate({});
    writeEntry(rawDir, 'claude-code', entry);
    const entries = await loadPrCorpus(rawDir);
    const label: GroundTruthLabel = {
      verdict: 'clean',
      rationale: 'First sentence here. Second sentence here. Third sentence here.',
      labeledBy: 'brad',
      labeledAt: '2026-05-23T11:00:00.000Z',
    };
    await writeLabel(labelsDir, entry.id, label);

    const out = await loadLabeledPrEntries(entries, labelsDir);
    assert.equal(out.labeled.length, 1);
    assert.equal(out.labeled[0]?.groundTruth.verdict, 'clean');
    assert.deepEqual(out.unlabeledIds, []);
    assert.deepEqual(out.invalidIds, []);
  });

  it('reports unlabeled entries instead of dropping them silently', async () => {
    const rawDir = path.join(tmpDir, 'raw');
    const labelsDir = path.join(tmpDir, 'labels');
    writeEntry(rawDir, 'claude-code', validEntryTemplate({}));
    const entries = await loadPrCorpus(rawDir);
    const out = await loadLabeledPrEntries(entries, labelsDir);
    assert.equal(out.labeled.length, 0);
    assert.equal(out.unlabeledIds.length, 1);
  });
});
