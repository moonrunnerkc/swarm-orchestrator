import { strict as assert } from 'assert';
import { INJECTORS } from '../../../src/audit/oracle/inject';
import { catchPathFor } from '../../../src/audit/oracle/category-map';
import { resolveDetectors } from '../../../src/audit/cheat-detector/detector-sets';
import { SEMANTIC_CHEAT_CATEGORIES } from '../../../src/audit/types';

// Guards the recall computation: if an injector stamps a category that no
// detector emits and that is not a semantic judge-primary category, the
// scorer would silently record recall 0 for a defect nothing can catch.
// CI fails here instead, so a new injector lands with a way to be scored.

describe('cheat-detector / category mapping', () => {
  const detectorNames = new Set(resolveDetectors('all').map((d) => d.name));

  it('maps every injector category to a detector or the judge-primary path', () => {
    for (const injector of INJECTORS) {
      const path = catchPathFor(injector.category);
      if (path.kind === 'detector') {
        assert.ok(
          detectorNames.has(path.detector),
          `injector ${injector.id} maps to detector "${path.detector}" which is not registered`,
        );
      } else {
        assert.ok(
          SEMANTIC_CHEAT_CATEGORIES.includes(path.category),
          `injector ${injector.id} maps to unknown semantic category "${path.category}"`,
        );
      }
    }
  });

  it('routes the two semantic categories to judge-primary, never to a detector', () => {
    for (const category of SEMANTIC_CHEAT_CATEGORIES) {
      const path = catchPathFor(category);
      assert.equal(path.kind, 'judge-primary', `${category} must not map to a structural detector`);
    }
  });

  it('routes each structural injector to a same-named detector', () => {
    const structural = INJECTORS.filter((i) => !SEMANTIC_CHEAT_CATEGORIES.includes(i.category as never));
    for (const injector of structural) {
      const path = catchPathFor(injector.category);
      assert.equal(path.kind, 'detector');
      if (path.kind === 'detector') {
        assert.equal(path.detector, injector.category);
      }
    }
  });
});
