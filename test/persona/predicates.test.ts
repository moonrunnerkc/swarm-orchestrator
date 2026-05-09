import { strict as assert } from 'assert';
import {
  personaTrigger,
  selectPersonaForState,
  unsatisfiedObligationOfType,
  type PopulationState,
} from '../../src/persona/predicates';
import {
  ARCHITECT_PERSONA,
  IMPLEMENTER_PERSONA,
  VERIFIER_PERSONA,
  createDefaultRegistry,
} from '../../src/persona/persona-registry';

function state(): PopulationState {
  return {
    obligations: [
      { type: 'file-must-exist', path: 'src/health.ts' },
      { type: 'build-must-pass', command: 'npm run build' },
      { type: 'test-must-pass', command: 'npm test' },
    ],
    status: ['pending', 'pending', 'pending'],
  };
}

describe('persona/predicates', () => {
  it('unsatisfiedObligationOfType returns the first pending of that type', () => {
    const pred = unsatisfiedObligationOfType('build-must-pass');
    assert.equal(pred(state()), 1);
  });

  it('unsatisfiedObligationOfType skips non-pending', () => {
    const pred = unsatisfiedObligationOfType('file-must-exist');
    const s: PopulationState = {
      ...state(),
      status: ['satisfied', 'pending', 'pending'],
    };
    assert.equal(pred(s), null);
  });

  it('personaTrigger fires only on a type the persona handles', () => {
    const trig = personaTrigger(ARCHITECT_PERSONA);
    assert.equal(trig(state()), 0);

    const noFiles: PopulationState = {
      obligations: [
        { type: 'build-must-pass', command: 'b' },
        { type: 'test-must-pass', command: 't' },
      ],
      status: ['pending', 'pending'],
    };
    assert.equal(trig(noFiles), null);
  });

  it('selectPersonaForState walks the registry and returns the first match', () => {
    const r = createDefaultRegistry();
    const sel = selectPersonaForState(r, state());
    assert.ok(sel);
    assert.equal(sel?.persona.id, ARCHITECT_PERSONA.id);
    assert.equal(sel?.obligationIndex, 0);
  });

  it('selectPersonaForState falls through to the next persona when the first has no work', () => {
    const r = createDefaultRegistry();
    const s: PopulationState = {
      ...state(),
      status: ['satisfied', 'pending', 'pending'],
    };
    const sel = selectPersonaForState(r, s);
    assert.ok(sel);
    assert.equal(sel?.persona.id, IMPLEMENTER_PERSONA.id);
    assert.equal(sel?.obligationIndex, 1);
  });

  it('selectPersonaForState returns null when nothing is pending', () => {
    const r = createDefaultRegistry();
    const s: PopulationState = {
      ...state(),
      status: ['satisfied', 'satisfied', 'satisfied'],
    };
    assert.equal(selectPersonaForState(r, s), null);
  });

  it('verifier persona handles test-must-pass', () => {
    const trig = personaTrigger(VERIFIER_PERSONA);
    const s: PopulationState = {
      ...state(),
      status: ['satisfied', 'satisfied', 'pending'],
    };
    assert.equal(trig(s), 2);
  });
});
