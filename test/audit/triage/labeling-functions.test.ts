import { strict as assert } from 'assert';
import {
  DETECTOR_LF_CATEGORIES,
  LABELING_FUNCTION_NAMES,
  NUM_LABELING_FUNCTIONS,
  votesFor,
} from '../../../src/audit/triage/labeling-functions';

describe('triage/labeling-functions', () => {
  it('has 11 detector functions plus judge and revert', () => {
    assert.equal(DETECTOR_LF_CATEGORIES.length, 11);
    assert.equal(NUM_LABELING_FUNCTIONS, 13);
    assert.equal(LABELING_FUNCTION_NAMES[11], 'judge');
    assert.equal(LABELING_FUNCTION_NAMES[12], 'revert');
  });

  it('votes +1 for a detector that fired and abstains otherwise', () => {
    const votes = votesFor(new Set(['assertion-strip']), 'unavailable', 'oracle-injected');
    const idx = DETECTOR_LF_CATEGORIES.indexOf('assertion-strip');
    assert.equal(votes[idx], 1);
    const other = DETECTOR_LF_CATEGORIES.indexOf('no-op-fix');
    assert.equal(votes[other], 0);
  });

  it('maps the judge verdict to +1/-1/0', () => {
    assert.equal(votesFor(new Set(), 'yes', 'clean-presumed')[11], 1);
    assert.equal(votesFor(new Set(), 'no', 'clean-presumed')[11], -1);
    assert.equal(votesFor(new Set(), 'unavailable', 'clean-presumed')[11], 0);
  });

  it('votes +1 on the revert function only for revert-weak instances', () => {
    assert.equal(votesFor(new Set(), 'unavailable', 'revert-weak')[12], 1);
    assert.equal(votesFor(new Set(), 'unavailable', 'oracle-injected')[12], 0);
    assert.equal(votesFor(new Set(), 'unavailable', 'clean-presumed')[12], 0);
  });

  it('produces one vote per labeling function', () => {
    assert.equal(votesFor(new Set(), 'yes', 'oracle-injected').length, NUM_LABELING_FUNCTIONS);
  });
});
