import { strict as assert } from 'assert';
import {
  ARCHITECT_PERSONA,
  DEFAULT_PERSONA_IDS,
  DEPENDENCY_AUDITOR_PERSONA,
  DOCUMENTATION_WRITER_PERSONA,
  IMPLEMENTER_PERSONA,
  MIGRATION_SPECIALIST_PERSONA,
  PersonaRegistry,
  SECURITY_REVIEWER_PERSONA,
  TEST_AUTHOR_PERSONA,
  VERIFIER_PERSONA,
  createDefaultRegistry,
} from '../../src/persona/persona-registry';

describe('persona/PersonaRegistry', () => {
  it('createDefaultRegistry exposes the eight Phase 7 personas in order', () => {
    const r = createDefaultRegistry();
    const ids = r.list().map((p) => p.id);
    assert.deepEqual(ids, [...DEFAULT_PERSONA_IDS]);
    assert.equal(ids.length, 8);
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

  it('each default persona handles a distinct obligation type (Phase 7: 8 types)', () => {
    const r = createDefaultRegistry();
    const types = r.list().flatMap((p) => p.handles);
    assert.deepEqual(
      [...types].sort(),
      [
        'build-must-pass',
        'coverage-must-exceed',
        'file-must-exist',
        'function-must-have-signature',
        'import-graph-must-satisfy',
        'performance-must-not-regress',
        'property-must-hold',
        'test-must-pass',
      ],
    );
    // Each persona claims at least one type, and no type is double-claimed
    // by the default registry.
    assert.equal(new Set(types).size, types.length);
  });

  it('each default persona has a non-empty system suffix and explicit sampling', () => {
    const all = [
      ARCHITECT_PERSONA,
      IMPLEMENTER_PERSONA,
      VERIFIER_PERSONA,
      SECURITY_REVIEWER_PERSONA,
      DEPENDENCY_AUDITOR_PERSONA,
      DOCUMENTATION_WRITER_PERSONA,
      MIGRATION_SPECIALIST_PERSONA,
      TEST_AUTHOR_PERSONA,
    ];
    for (const p of all) {
      assert.ok(p.systemSuffix.length > 0, `${p.id} systemSuffix non-empty`);
      assert.ok(p.sampling.maxTokens > 0, `${p.id} maxTokens > 0`);
      assert.ok(typeof p.sampling.temperature === 'number');
      assert.ok(['haiku', 'sonnet', 'opus'].includes(p.tier));
      assert.ok(p.handles.length > 0, `${p.id} handles at least one obligation type`);
    }
  });
});
