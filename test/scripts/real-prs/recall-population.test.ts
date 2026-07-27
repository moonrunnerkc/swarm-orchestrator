import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolvePopulation,
  threeColumnPopulation,
  type ViabilityRow,
} from '../../../scripts/real-prs/lib/recall-population';

const V4_DATASET = path.join('benchmarks', 'real-prs', 'wild-cheat-corpus', 'v4', 'dataset.json');
const V3_DATASET = path.join('benchmarks', 'real-prs', 'wild-cheat-corpus', 'v3', 'dataset.json');
const VIABILITY = path.join(
  'benchmarks',
  'real-prs',
  'capability-hunt',
  'b2-ab',
  'corpus-viability-delta.json',
);

function readEntries(file: string): Array<{ id: string; egViable: boolean }> {
  return (
    JSON.parse(fs.readFileSync(file, 'utf8')) as {
      entries: Array<{ id: string; egViable: boolean }>;
    }
  ).entries;
}

function readViability(): ViabilityRow[] {
  return (JSON.parse(fs.readFileSync(VIABILITY, 'utf8')) as { records: ViabilityRow[] }).records;
}

describe('scripts/real-prs recall population', () => {
  it('keeps the frozen flags when no viability refresh is supplied', () => {
    const entries = [
      { id: 'a', egViable: true },
      { id: 'b', egViable: false },
    ];
    const resolved = resolvePopulation(entries, null);
    assert.deepEqual(
      resolved.viable.map((p) => p.entry.id),
      ['a'],
    );
    assert.deepEqual(
      resolved.nonviable.map((p) => p.entry.id),
      ['b'],
    );
    assert.equal(resolved.all[0]!.source, 'frozen-dataset');
    assert.deepEqual(resolved.recoveredIds, []);
    assert.deepEqual(resolved.lostIds, []);
  });

  it('lets a refresh row supersede the frozen flag in both directions', () => {
    const entries = [
      { id: 'recovered', egViable: false },
      { id: 'lost', egViable: true },
      { id: 'unchanged', egViable: true },
    ];
    const resolved = resolvePopulation(entries, [
      { id: 'recovered', viableAfter: true, reason: 'viable: subdir manifest' },
      { id: 'lost', viableAfter: false, reason: 'no lockfile' },
      { id: 'unchanged', viableAfter: true },
    ]);
    assert.deepEqual(resolved.recoveredIds, ['recovered']);
    assert.deepEqual(resolved.lostIds, ['lost']);
    assert.equal(resolved.viable.length, 2);
    assert.equal(resolved.all[0]!.source, 'viability-refresh');
    assert.equal(resolved.all[0]!.reason, 'viable: subdir manifest');
    assert.equal(resolved.all[2]!.changed, false);
  });

  it('keeps an entry the refresh does not mention on its frozen flag', () => {
    const resolved = resolvePopulation(
      [
        { id: 'a', egViable: true },
        { id: 'missing', egViable: false },
      ],
      [{ id: 'a', viableAfter: true }],
    );
    assert.equal(resolved.all.length, 2);
    assert.equal(resolved.all[1]!.source, 'frozen-dataset');
    assert.equal(resolved.all[1]!.viable, false);
  });

  it('resolves the committed v4 corpus against the committed B2 refresh', () => {
    const resolved = resolvePopulation(readEntries(V4_DATASET), readViability());
    // Matches the totals block of the committed refresh: 31 entries, 8 viable
    // before, 20 after. A drift here means the population moved under a pass.
    assert.equal(resolved.all.length, 31);
    assert.equal(resolved.viable.length, 20);
    assert.equal(resolved.nonviable.length, 11);
    assert.deepEqual(resolved.lostIds, []);
    assert.equal(resolved.recoveredIds.length, 12);
  });

  it('splits the v3 headline from the v4 additions', () => {
    const v3Ids = new Set(readEntries(V3_DATASET).map((e) => e.id));
    const resolved = resolvePopulation(readEntries(V4_DATASET), readViability());
    const v3Viable = resolved.viable.filter((p) => v3Ids.has(p.entry.id));
    const v4Viable = resolved.viable.filter((p) => !v3Ids.has(p.entry.id));
    // Amendment 4: the v4 additions are reported on their own line and never
    // sum into the v3 headline.
    assert.equal(v3Ids.size, 29);
    assert.equal(v3Viable.length, 19);
    assert.deepEqual(
      v4Viable.map((p) => p.entry.id),
      ['matrixorigin-matrixone-pr25683'],
    );
  });

  it('counts provisioned, controls-executable, and proven as three distinct sets', () => {
    const counts = threeColumnPopulation([
      { bucket: 'proven', provisioned: true, controlsExecuted: true },
      { bucket: 'advisory-found', provisioned: true, controlsExecuted: true },
      { bucket: 'abstained', provisioned: true, controlsExecuted: false },
      { bucket: 'not-provisionable', provisioned: false, controlsExecuted: false },
    ]);
    assert.equal(counts.provisioned, 3);
    assert.equal(counts.controlsExecutable, 2);
    assert.equal(counts.proven, 1);
    assert.equal(counts.ruleOfThreeUpperBound, null);
  });

  it('publishes a rule-of-three ceiling only when nothing was proven', () => {
    const rows = Array.from({ length: 12 }, () => ({
      bucket: 'abstained',
      provisioned: true,
      controlsExecuted: true,
    }));
    const counts = threeColumnPopulation(rows);
    assert.equal(counts.proven, 0);
    assert.equal(counts.controlsExecutable, 12);
    assert.equal(counts.ruleOfThreeUpperBound, 0.25);
  });

  it('leaves the ceiling undefined when no control ever executed', () => {
    const counts = threeColumnPopulation([
      { bucket: 'abstained', provisioned: true, controlsExecuted: false },
    ]);
    assert.equal(counts.proven, 0);
    assert.equal(counts.controlsExecutable, 0);
    // 3/0 is not a bound. A zero over zero controls says nothing was measured.
    assert.equal(counts.ruleOfThreeUpperBound, null);
  });
});
