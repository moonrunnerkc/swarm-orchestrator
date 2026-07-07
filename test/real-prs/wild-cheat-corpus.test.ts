import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  HeldOutCorpusError,
  loadWildCheatCorpus,
  type WildCheatDataset,
} from '../../scripts/real-prs/lib/wild-cheat-corpus';
import { buildWildCheatEntries } from '../../scripts/corpus/export-wild-cheats';

function writeDataset(dir: string, dataset: WildCheatDataset): void {
  fs.mkdirSync(path.join(dir, dataset.version), { recursive: true });
  fs.writeFileSync(
    path.join(dir, dataset.version, 'dataset.json'),
    `${JSON.stringify(dataset, null, 2)}\n`,
  );
}

const sampleDataset: WildCheatDataset = {
  version: 'v1',
  generatedBy: 'test',
  note: '',
  counts: { entries: 1, merged: 1, closed: 0, egViable: 1 },
  entries: [
    {
      id: 'claude-code-foo-bar-pr1',
      repo: 'foo/bar',
      prNumber: 1,
      url: 'https://github.com/foo/bar/pull/1',
      state: 'merged',
      vendor: 'claude-code',
      vendorConfidence: 'high',
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      complaintCategory: 'assertion-strip',
      complaints: [{ category: 'assertion-strip', phrase: 'removed the assertion', source: 'review' }],
      outcome: 'unknown',
      egViable: true,
      crossTaxonomy: 'reward-hacking / weakened-oracle',
      holdout: true,
    },
  ],
};

describe('loadWildCheatCorpus hold-out enforcement', () => {
  it('refuses to hand held-out entries to a non-evaluation caller', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcc-'));
    try {
      writeDataset(dir, sampleDataset);
      assert.throws(
        () => loadWildCheatCorpus({ forEvaluation: false, dir }),
        (err: unknown) => err instanceof HeldOutCorpusError,
        'a tuning/calibration load must be rejected in code, not by convention',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves the corpus to an evaluation caller', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcc-'));
    try {
      writeDataset(dir, sampleDataset);
      const entries = loadWildCheatCorpus({ forEvaluation: true, dir });
      assert.equal(entries.length, 1);
      assert.equal(entries[0]!.holdout, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a clear error when the dataset is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcc-empty-'));
    try {
      assert.throws(
        () => loadWildCheatCorpus({ forEvaluation: true, dir }),
        /wild cheat corpus not found/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildWildCheatEntries', () => {
  it('keeps only complaint-carrying PRs and maps state/attribution/category', () => {
    const population = [
      {
        id: 'p1',
        repo: 'o/r',
        prNumber: 5,
        headSha: 'h',
        baseSha: 'b',
        url: 'u',
        vendor: 'devin',
        vendorConfidence: 'medium',
        outcome: 'hotfixed',
        merged: false,
        viable: true,
        complaints: [{ category: 'no-op-fix', phrase: "doesn't actually fix", source: 'issue-comment' }],
      },
      { id: 'p2', repo: 'o/r2', prNumber: 6, headSha: 'h', baseSha: 'b', url: 'u', vendor: 'cursor', merged: true, viable: false, complaints: [] },
    ];
    const entries = buildWildCheatEntries(population);
    assert.equal(entries.length, 1, 'the no-complaint PR is dropped');
    const [e] = entries;
    assert.equal(e!.state, 'closed', 'merged=false maps to closed');
    assert.equal(e!.vendor, 'devin');
    assert.equal(e!.complaintCategory, 'no-op-fix');
    assert.equal(e!.crossTaxonomy, 'specification-gaming / non-fix');
    assert.equal(e!.holdout, true);
  });
});
