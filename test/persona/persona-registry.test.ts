import { strict as assert } from 'assert';
import {
  ARCHITECT_PERSONA,
  DEFAULT_PERSONA_IDS,
  IMPLEMENTER_PERSONA,
  PersonaRegistry,
  VERIFIER_PERSONA,
  createDefaultRegistry,
} from '../../src/persona/persona-registry';

describe('persona/PersonaRegistry', () => {
  it('createDefaultRegistry exposes architect, implementer, verifier in order', () => {
    const r = createDefaultRegistry();
    const ids = r.list().map((p) => p.id);
    assert.deepEqual(ids, [...DEFAULT_PERSONA_IDS]);
  });

  it('register rejects duplicate ids', () => {
    const r = new PersonaRegistry();
    r.register(ARCHITECT_PERSONA);
    assert.throws(() => r.register(ARCHITECT_PERSONA), /already registered/);
  });

  it('replace overwrites without throwing', () => {
    const r = new PersonaRegistry([ARCHITECT_PERSONA]);
    const updated = { ...ARCHITECT_PERSONA, role: 'updated' };
    r.replace(updated);
    assert.equal(r.require('architect').role, 'updated');
  });

  it('require throws on missing persona with helpful message', () => {
    const r = new PersonaRegistry([ARCHITECT_PERSONA]);
    assert.throws(() => r.require('nope'), /known: architect/);
  });

  it('each default persona handles a distinct obligation type', () => {
    const r = createDefaultRegistry();
    const types = r.list().flatMap((p) => p.handles);
    assert.deepEqual(
      [...types].sort(),
      ['build-must-pass', 'file-must-exist', 'test-must-pass'],
    );
  });

  it('each default persona has a non-empty system suffix and explicit sampling', () => {
    for (const p of [ARCHITECT_PERSONA, IMPLEMENTER_PERSONA, VERIFIER_PERSONA]) {
      assert.ok(p.systemSuffix.length > 0, `${p.id} systemSuffix non-empty`);
      assert.ok(p.sampling.maxTokens > 0, `${p.id} maxTokens > 0`);
      assert.ok(typeof p.sampling.temperature === 'number');
      assert.ok(['haiku', 'sonnet', 'opus'].includes(p.tier));
    }
  });
});
