import { strict as assert } from 'assert';
import { fixtureEntrypoint } from '../../src/index';
import { PHASE_1_FIXTURE_MARKER } from '../../src/falsification/placeholder';

describe('phase-1-gate fixture placeholder', () => {
  it('exports the fixture entrypoint string', () => {
    assert.equal(fixtureEntrypoint(), 'phase-1-gate fixture');
  });

  it('exports the falsification subtree marker', () => {
    assert.equal(typeof PHASE_1_FIXTURE_MARKER, 'string');
    assert.ok(PHASE_1_FIXTURE_MARKER.length > 0);
  });
});
