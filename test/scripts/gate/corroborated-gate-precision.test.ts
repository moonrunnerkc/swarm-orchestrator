import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeCorroboratedGatePrecision } from '../../../scripts/gate/corroborated-gate-precision';

interface ViabilityRecord {
  outcome: string;
  ecosystem: string | null;
  viable: boolean;
}

function writeInputs(
  corroboratedByDetector: Record<string, { truePositive: number; falsePositive: number }>,
  records: ViabilityRecord[],
): { corroboratedFile: string; viabilityFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-cgp-'));
  const corroboratedFile = path.join(dir, 'eg-viable-corroborated.json');
  const viabilityFile = path.join(dir, 'eg-viability.json');
  fs.writeFileSync(
    corroboratedFile,
    JSON.stringify({ prsMeasured: records.length, prsCovered: records.length, corroboratedByDetector }),
  );
  const provisionable = records.filter((r) => r.viable && r.ecosystem === 'node');
  fs.writeFileSync(
    viabilityFile,
    JSON.stringify({
      screened: records.length,
      viableCount: records.filter((r) => r.viable).length,
      provisionableCount: provisionable.length,
      records,
    }),
  );
  return { corroboratedFile, viabilityFile };
}

describe('scripts/gate/corroborated-gate-precision', () => {
  it('is undefined-n when the provisionable slice is all outcome-clean (the current corpus)', () => {
    const inputs = writeInputs({}, [
      { outcome: 'survived', ecosystem: 'node', viable: true },
      { outcome: 'survived', ecosystem: 'node', viable: true },
      // A viable-but-not-provisionable outcome-bad python PR must NOT count.
      { outcome: 'hotfixed', ecosystem: 'python', viable: true },
    ]);
    const out = computeCorroboratedGatePrecision(inputs);
    assert.equal(out.slice.outcomeBadInProvisionable, 0);
    assert.equal(out.aggregate.status, 'undefined-n');
    assert.deepEqual(out.slice.outcomeBreakdownProvisionable, { survived: 2 });
  });

  it('lights up ready when the provisionable slice has outcome-bad PRs and precision is proven', () => {
    const records: ViabilityRecord[] = [];
    for (let i = 0; i < 8; i += 1) records.push({ outcome: 'hotfixed', ecosystem: 'node', viable: true });
    for (let i = 0; i < 20; i += 1) records.push({ outcome: 'survived', ecosystem: 'node', viable: true });
    const inputs = writeInputs(
      { 'test-relaxation': { truePositive: 60, falsePositive: 0 } },
      records,
    );
    const out = computeCorroboratedGatePrecision(inputs);
    assert.equal(out.slice.outcomeBadInProvisionable, 8);
    assert.equal(out.aggregate.status, 'ready');
    assert.equal(out.aggregate.truePositive, 60);
    assert.ok(out.aggregate.wilson !== null && out.aggregate.wilson.lower >= out.wilsonFloor);
  });

  it('is not-ready when corroborated findings are mostly false positives', () => {
    const records: ViabilityRecord[] = [
      { outcome: 'hotfixed', ecosystem: 'node', viable: true },
      { outcome: 'survived', ecosystem: 'node', viable: true },
    ];
    const inputs = writeInputs(
      { 'assertion-strip': { truePositive: 2, falsePositive: 20 } },
      records,
    );
    const out = computeCorroboratedGatePrecision(inputs);
    assert.equal(out.aggregate.status, 'not-ready');
    assert.ok(out.aggregate.precision !== null && out.aggregate.precision < 0.2);
  });

  it('sorts per-detector rows deterministically', () => {
    const inputs = writeInputs(
      {
        zeta: { truePositive: 1, falsePositive: 0 },
        alpha: { truePositive: 1, falsePositive: 0 },
      },
      [{ outcome: 'hotfixed', ecosystem: 'node', viable: true }],
    );
    const out = computeCorroboratedGatePrecision(inputs);
    assert.deepEqual(
      out.perDetector.map((d) => d.detector),
      ['alpha', 'zeta'],
    );
  });
});
