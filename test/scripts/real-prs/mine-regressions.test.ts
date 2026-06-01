import { strict as assert } from 'assert';
import { extractRegressionSignals } from '../../../scripts/real-prs/lib/github';

describe('scripts/real-prs/lib/github extractRegressionSignals', () => {
  it('labels the reverted PR bad from a Revert title + Reverts #N body', () => {
    const sigs = extractRegressionSignals({
      number: 200,
      title: 'Revert "feat: add streaming parser"',
      body: 'This reverts #150 because it broke SSR.',
      html_url: 'https://github.com/o/r/pull/200',
    });
    assert.equal(sigs.length, 1);
    assert.equal(sigs[0]?.badPrNumber, 150);
    assert.equal(sigs[0]?.kind, 'revert');
    assert.equal(sigs[0]?.url, 'https://github.com/o/r/pull/200');
  });

  it('labels the referenced PR bad from a fix-PR "regression from #N"', () => {
    const sigs = extractRegressionSignals({
      number: 311,
      title: 'fix: restore lost cache key',
      body: 'This is a regression from #305 introduced last week.',
      html_url: 'https://github.com/o/r/pull/311',
    });
    assert.equal(sigs.length, 1);
    assert.equal(sigs[0]?.badPrNumber, 305);
    assert.equal(sigs[0]?.kind, 'fix-pr');
  });

  it('matches "broken by #N" and "introduced in #N"', () => {
    const a = extractRegressionSignals({ number: 5, title: 'fix x', body: 'broken by #4', html_url: 'u' });
    assert.equal(a[0]?.badPrNumber, 4);
    const b = extractRegressionSignals({ number: 9, title: 'fix y', body: 'bug introduced in #7', html_url: 'u' });
    assert.equal(b[0]?.badPrNumber, 7);
  });

  it('drops self-references and de-duplicates the same bad PR', () => {
    const sigs = extractRegressionSignals({
      number: 42,
      title: 'Revert something',
      body: 'reverts #42 reverts #42 regression from #42',
      html_url: 'u',
    });
    assert.equal(sigs.length, 0);
  });

  it('returns nothing when no signal phrase is present', () => {
    const sigs = extractRegressionSignals({
      number: 1,
      title: 'feat: add a new flag',
      body: 'closes #3, see #4 for context',
      html_url: 'u',
    });
    assert.equal(sigs.length, 0);
  });
});
