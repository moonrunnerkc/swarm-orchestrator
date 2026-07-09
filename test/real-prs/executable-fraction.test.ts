import { strict as assert } from 'assert';
import {
  computeExecutableFraction,
  PROOF_EXECUTABLE_ECOSYSTEMS,
  type IntakeRecordLike,
} from '../../scripts/real-prs/executable-fraction';

describe('computeExecutableFraction', () => {
  it('counts only EG-viable records in an engine-backed ecosystem as proof-executable', () => {
    const records: IntakeRecordLike[] = [
      { id: 'a', egViable: true, egEcosystem: 'python' },
      { id: 'b', egViable: true, egEcosystem: 'node' },
      { id: 'c', egViable: false, egEcosystem: 'node' }, // recognized but not provisionable
      { id: 'd', egViable: false, egEcosystem: null }, // unrecognized
      { id: 'e', egViable: false, egEcosystem: 'elixir' }, // no engine
      { id: 'f', egViable: true, egEcosystem: 'go' },
    ];
    const out = computeExecutableFraction(records);
    assert.equal(out.total, 6);
    assert.equal(out.proofExecutable, 3);
    assert.equal(out.fraction, 0.5);
    assert.deepEqual(out.byEcosystem, { python: 1, node: 1, go: 1 });
    assert.deepEqual(out.provisionableGap, { node: 1 });
    assert.deepEqual(out.nonExecutable, { unrecognized: 1, elixir: 1 });
  });

  it('makes the three buckets exhaustive: they sum to total', () => {
    const records: IntakeRecordLike[] = [
      { egViable: true, egEcosystem: 'python' },
      { egViable: false, egEcosystem: 'go' },
      { egViable: false, egEcosystem: null },
      { egViable: true, egEcosystem: 'elixir' }, // viable ecosystem but no engine
    ];
    const out = computeExecutableFraction(records);
    const sum =
      out.proofExecutable +
      Object.values(out.provisionableGap).reduce((a, b) => a + b, 0) +
      Object.values(out.nonExecutable).reduce((a, b) => a + b, 0);
    assert.equal(sum, out.total);
  });

  it('treats elixir as non-executable (no proof engine) even when marked viable', () => {
    const out = computeExecutableFraction([{ egViable: true, egEcosystem: 'elixir' }]);
    assert.equal(out.proofExecutable, 0);
    assert.deepEqual(out.nonExecutable, { elixir: 1 });
    assert.equal(PROOF_EXECUTABLE_ECOSYSTEMS.has('elixir'), false);
  });

  it('is zero for an empty intake', () => {
    const out = computeExecutableFraction([]);
    assert.equal(out.total, 0);
    assert.equal(out.fraction, 0);
  });
});
