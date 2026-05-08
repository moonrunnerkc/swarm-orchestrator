import { strict as assert } from 'assert';
import {
  isKnownBoilerplate,
  pickStrategyForFile,
  tagObligations,
  tagSummary,
} from '../../src/contract/tagger';
import { DEFAULT_STRATEGY_NAMES } from '../../src/wasm/registry';
import type { ObligationV1 } from '../../src/contract/types';

const available = new Set<string>(DEFAULT_STRATEGY_NAMES);

describe('contract/tagger', () => {
  it('tags a known-boilerplate file-must-exist with scaffold-template', () => {
    const obligations: ObligationV1[] = [
      { type: 'file-must-exist', path: 'LICENSE' },
      { type: 'file-must-exist', path: '.gitignore' },
      { type: 'file-must-exist', path: 'docs/note.md' },
    ];
    const tagged = tagObligations(obligations, {
      availableStrategies: DEFAULT_STRATEGY_NAMES,
    });
    for (const o of tagged) {
      assert.equal(o.deterministicStrategy, 'scaffold-template');
    }
  });

  it('does not tag file-must-exist for paths without a template', () => {
    const obligations: ObligationV1[] = [
      { type: 'file-must-exist', path: 'src/code.ts' },
      { type: 'file-must-exist', path: 'odd/path.weird' },
    ];
    const tagged = tagObligations(obligations, {
      availableStrategies: DEFAULT_STRATEGY_NAMES,
    });
    for (const o of tagged) {
      assert.equal(o.deterministicStrategy, undefined);
    }
  });

  it('does not tag build-must-pass or test-must-pass obligations', () => {
    const obligations: ObligationV1[] = [
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ];
    const tagged = tagObligations(obligations, {
      availableStrategies: DEFAULT_STRATEGY_NAMES,
    });
    for (const o of tagged) {
      assert.equal(o.deterministicStrategy, undefined);
    }
  });

  it('preserves an existing deterministicStrategy tag', () => {
    const obligations: ObligationV1[] = [
      { type: 'file-must-exist', path: 'LICENSE', deterministicStrategy: 'format-prettier' },
    ];
    const tagged = tagObligations(obligations, {
      availableStrategies: DEFAULT_STRATEGY_NAMES,
    });
    assert.equal(tagged[0]?.deterministicStrategy, 'format-prettier');
  });

  it('skips strategies that are not in the available set', () => {
    const obligations: ObligationV1[] = [{ type: 'file-must-exist', path: 'LICENSE' }];
    const tagged = tagObligations(obligations, { availableStrategies: [] });
    assert.equal(tagged[0]?.deterministicStrategy, undefined);
  });

  it('does not mutate the input array', () => {
    const obligations: ObligationV1[] = [{ type: 'file-must-exist', path: 'LICENSE' }];
    const before = JSON.stringify(obligations);
    tagObligations(obligations, { availableStrategies: DEFAULT_STRATEGY_NAMES });
    assert.equal(JSON.stringify(obligations), before);
  });

  it('tagSummary reports counts and per-strategy breakdown', () => {
    const before: ObligationV1[] = [
      { type: 'file-must-exist', path: 'LICENSE' },
      { type: 'file-must-exist', path: 'src/code.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
    ];
    const after = tagObligations(before, { availableStrategies: DEFAULT_STRATEGY_NAMES });
    const summary = tagSummary(before, after);
    assert.equal(summary.tagged, 1);
    assert.equal(summary.untagged, 2);
    assert.equal(summary.byStrategy['scaffold-template'], 1);
  });

  it('tagSummary throws on length mismatch', () => {
    assert.throws(() => tagSummary([], [{ type: 'file-must-exist', path: 'a' }]), /parallel arrays/);
  });

  it('pickStrategyForFile returns scaffold-template for boilerplate', () => {
    assert.equal(pickStrategyForFile('LICENSE', available), 'scaffold-template');
    assert.equal(pickStrategyForFile('subdir/CHANGELOG.md', available), 'scaffold-template');
  });

  it('pickStrategyForFile returns null for unmatched paths', () => {
    assert.equal(pickStrategyForFile('src/code.ts', available), null);
  });

  it('isKnownBoilerplate matches templated basenames and extensions', () => {
    assert.equal(isKnownBoilerplate('LICENSE'), true);
    assert.equal(isKnownBoilerplate('foo/LICENSE'), true);
    assert.equal(isKnownBoilerplate('docs/note.md'), true);
    assert.equal(isKnownBoilerplate('src/code.weird'), false);
  });
});
