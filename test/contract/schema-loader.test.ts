import { strict as assert } from 'assert';
import {
  loadObligationSchema,
  obligationValidator,
  resetSchemaCacheForTest,
} from '../../src/contract/schema/loader';

describe('contract/schema/loader', () => {
  beforeEach(() => {
    resetSchemaCacheForTest();
  });

  it('loads the v1 schema with the three Phase 1 + five Phase 7 obligation types', () => {
    const schema = loadObligationSchema() as { oneOf: Array<{ title: string }> };
    const titles = schema.oneOf.map((s) => s.title).sort();
    assert.deepEqual(titles, [
      'build-must-pass',
      'coverage-must-exceed',
      'file-must-exist',
      'function-must-have-signature',
      'import-graph-must-satisfy',
      'performance-must-not-regress',
      'property-must-hold',
      'test-must-pass',
    ]);
  });

  it('compiles a validator that accepts file-must-exist', () => {
    const validate = obligationValidator();
    assert.equal(validate({ type: 'file-must-exist', path: 'src/a.ts' }), true);
  });

  it('compiles a validator that rejects unknown types', () => {
    const validate = obligationValidator();
    assert.equal(validate({ type: 'unknown', path: 'src/a.ts' }), false);
  });

  it('caches the compiled validator across calls', () => {
    const a = obligationValidator();
    const b = obligationValidator();
    assert.equal(a, b);
  });
});
