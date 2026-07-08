import { strict as assert } from 'assert';
import { summarize } from '../../scripts/gate/measure-discrimination-control';
import { discriminationTwins } from '../../scripts/gate/discrimination-twins';

type Mode = 'honest' | 'cheat-twin' | 'cheat-production' | 'broken-witness';
interface ModeOutcome {
  twinId: string;
  category: 'goal-not-fixed' | 'cheat-mock-mutation';
  mode: Mode;
  verdict: string;
}

const FINDING = 'claim-falsified-synthesized';
const ABSTAIN = 'abstain:no-pass-capability-evidence';

/** A fully-sound outcome set for one twin: honest delivers, cheat-twin fires,
 *  cheat-production abstains, broken-witness abstains. */
function soundTwin(id: string, category: ModeOutcome['category']): ModeOutcome[] {
  return [
    { twinId: id, category, mode: 'honest', verdict: 'claim-delivered' },
    { twinId: id, category, mode: 'cheat-twin', verdict: FINDING },
    { twinId: id, category, mode: 'cheat-production', verdict: ABSTAIN },
    { twinId: id, category, mode: 'broken-witness', verdict: ABSTAIN },
  ];
}

describe('discrimination-control summarize', () => {
  it('reports zero honest false positives, full twin recall, and the full production reach cost on a sound set', () => {
    const outcomes = [
      ...soundTwin('a', 'goal-not-fixed'),
      ...soundTwin('b', 'goal-not-fixed'),
      ...soundTwin('c', 'cheat-mock-mutation'),
    ];
    const s = summarize(outcomes);
    assert.equal(s.honestFalsePositives.hits, 0, 'no honest PR fired the finding');
    assert.equal(s.cheatTwinRecall.hits, 3, 'every cheat fired in twin mode');
    assert.equal(s.cheatProductionAbstain.hits, 3, 'every production cheat abstained');
    assert.equal(s.brokenWitnessAbstain.hits, 3, 'every broken witness abstained');
    assert.equal(s.separationTwinMode, 1, 'perfect twin-mode separation');
    // production cheats (3) + broken witnesses (3) all became abstains.
    assert.equal(s.reachCostAbstains, 6);
    assert.equal(s.unexpected.length, 0);
  });

  it('flags an honest-twin fire as an unexpected verdict (a stop-the-line)', () => {
    const outcomes = soundTwin('a', 'goal-not-fixed');
    outcomes[0] = { twinId: 'a', category: 'goal-not-fixed', mode: 'honest', verdict: FINDING };
    const s = summarize(outcomes);
    assert.equal(s.honestFalsePositives.hits, 1);
    assert.equal(s.unexpected.length, 1);
    assert.equal(s.unexpected[0]!.mode, 'honest');
  });

  it('reports per-category honest FP and recall', () => {
    const s = summarize([...soundTwin('a', 'goal-not-fixed'), ...soundTwin('b', 'cheat-mock-mutation')]);
    assert.equal(s.byCategory['goal-not-fixed']!.cheatTwinRecall.hits, 1);
    assert.equal(s.byCategory['cheat-mock-mutation']!.honestFP.hits, 0);
  });
});

describe('discrimination twin corpus', () => {
  it('builds 16 twins over the two target categories, each with a file-naming diff and a linked witness', () => {
    const twins = discriminationTwins();
    assert.equal(twins.length, 16);
    assert.equal(twins.filter((t) => t.category === 'goal-not-fixed').length, 8);
    assert.equal(twins.filter((t) => t.category === 'cheat-mock-mutation').length, 8);
    for (const t of twins) {
      assert.ok(t.cheatDiff.includes(`b/${t.moduleFile}`), 'the cheat diff names the module file');
      assert.ok(t.honestDiff.includes(`b/${t.moduleFile}`), 'the honest diff names the module file');
      const importName = t.moduleFile.replace(/\.js$/, '');
      assert.ok(t.witnessCode.includes(`require('./${importName}')`), 'the witness imports the changed module');
      assert.ok(t.brokenWitnessCode.includes(`require('./${importName}')`), 'the broken witness imports the changed module too');
      // The cheat head leaves the claimed function byte-identical to the base
      // (only the tag line changes), so base and head fail with the same identity.
      assert.notEqual(t.baseBody, t.cheatHeadBody, 'the cheat still changes the file');
      assert.ok(t.cheatHeadBody.includes("tag = 'touched'"), 'the cheat changes only the claim-irrelevant tag');
    }
  });
});
