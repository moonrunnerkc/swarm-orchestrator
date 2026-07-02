import { strict as assert } from 'assert';
import { buildDataset } from '../../../src/audit/triage/dataset';
import { applyDenoise, type InstanceVerdict } from '../../../src/audit/triage/denoise';
import type { TriageInstance } from '../../../src/audit/triage/types';

function inst(over: Partial<TriageInstance> & Pick<TriageInstance, 'id' | 'tier' | 'label'>): TriageInstance {
  return {
    category: null,
    sourcePrUrl: 'u',
    diffPath: 'd',
    sha256: 's',
    ...over,
  };
}

describe('triage/denoise', () => {
  const dataset = buildDataset([
    inst({ id: 'oracle-injected:a/x', tier: 'oracle-injected', label: 'positive' }),
    inst({ id: 'revert-weak:a#1', tier: 'revert-weak', label: 'positive' }),
    inst({ id: 'revert-weak:a#2', tier: 'revert-weak', label: 'positive' }),
    inst({ id: 'revert-weak:a#3', tier: 'revert-weak', label: 'positive' }),
    inst({ id: 'clean-presumed:a#9', tier: 'clean-presumed', label: 'unlabeled' }),
  ]);

  it('demotes only revert-weak positives the judge refutes', () => {
    const verdicts: InstanceVerdict[] = [
      { id: 'oracle-injected:a/x', verdict: 'no' }, // ignored: ground truth
      { id: 'revert-weak:a#1', verdict: 'no' }, // demoted
      { id: 'revert-weak:a#2', verdict: 'yes' }, // confirmed
      // revert-weak:a#3 has no verdict -> abstained, kept
      { id: 'clean-presumed:a#9', verdict: 'yes' }, // ignored: stays unlabeled
    ];
    const { dataset: out, summary } = applyDenoise(dataset, verdicts);
    assert.deepEqual(summary, { demoted: 1, confirmed: 1, abstained: 1 });

    const byId = new Map(out.instances.map((i) => [i.id, i]));
    // Ground-truth oracle positive is never overridden.
    assert.equal(byId.get('oracle-injected:a/x')?.label, 'positive');
    // Refuted revert demoted to unlabeled, tier preserved.
    assert.equal(byId.get('revert-weak:a#1')?.label, 'unlabeled');
    assert.equal(byId.get('revert-weak:a#1')?.tier, 'revert-weak');
    // Confirmed and abstained revert positives stay positive.
    assert.equal(byId.get('revert-weak:a#2')?.label, 'positive');
    assert.equal(byId.get('revert-weak:a#3')?.label, 'positive');
    // Clean stays unlabeled regardless of verdict.
    assert.equal(byId.get('clean-presumed:a#9')?.label, 'unlabeled');
  });

  it('recomputes the corpus digest after denoise', () => {
    const refuteAll: InstanceVerdict[] = [
      { id: 'revert-weak:a#1', verdict: 'no' },
      { id: 'revert-weak:a#2', verdict: 'no' },
      { id: 'revert-weak:a#3', verdict: 'no' },
    ];
    const { dataset: out } = applyDenoise(dataset, refuteAll);
    assert.notEqual(out.corpusSha256, dataset.corpusSha256);
    assert.equal(out.summary.positives, 1); // only the oracle positive remains
  });
});
