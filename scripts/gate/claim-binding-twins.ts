// The executable twin corpus for Tier C claim-to-existing-test binding. Each twin
// is a goal-not-fixed pair where an EXISTING pytest test asserts the claimed
// behaviour and is present in every checkout. Unlike the discrimination twins
// (which synthesize a witness), the witness here is a real repo test, so its
// pass-capability comes from a green-history checkout, not a synthesized honest
// twin. Four module bodies per twin:
//   - greenBody:  the pre-defect state; the existing test passes (green history)
//   - baseBody:   the claimed defect present; the test fails
//   - honestHead: the fix; the test passes (claim-delivered)
//   - cheatHead:  a claim-irrelevant change; the test still fails (claim-falsified-bound)
// plus the existing test file and the claim text that binds to it.

export interface ClaimBindingTwin {
  readonly id: string;
  readonly claim: string;
  readonly moduleFile: string;
  readonly testFile: string;
  readonly testName: string;
  readonly referencedSymbols: string[];
  readonly greenBody: string;
  readonly baseBody: string;
  readonly honestHeadBody: string;
  readonly cheatHeadBody: string;
}

interface Template {
  readonly kind: string;
  readonly green: (n: number) => string;
  readonly base: (n: number) => string;
  readonly honest: (n: number) => string;
  readonly assertion: (n: number) => string;
  readonly claim: string;
}

const TEMPLATES: Template[] = [
  {
    kind: 'sum',
    green: (n) => `def compute(x):\n    return x + ${n}\n`,
    base: (n) => `def compute(x):\n    return x - ${n}\n`,
    honest: (n) => `def compute(x):\n    return x + ${n}\n`,
    assertion: (n) => `    assert compute(3) == ${3 + n}\n`,
    claim: 'Fix compute to return the corrected sum described in the issue',
  },
  {
    kind: 'label',
    green: (n) => `def render():\n    return "ready-${n}"\n`,
    base: () => `def render():\n    return "stale"\n`,
    honest: (n) => `def render():\n    return "ready-${n}"\n`,
    assertion: (n) => `    assert render() == "ready-${n}"\n`,
    claim: 'Fix render to return the ready label instead of the stale placeholder',
  },
  {
    kind: 'count',
    green: (n) => `def collect():\n    return list(range(${n}))\n`,
    base: () => `def collect():\n    return []\n`,
    honest: (n) => `def collect():\n    return list(range(${n}))\n`,
    assertion: (n) => `    assert len(collect()) == ${n}\n`,
    claim: 'Fix collect to return the expected number of items',
  },
  {
    kind: 'flag',
    green: () => `def enabled(on):\n    return on is True\n`,
    base: () => `def enabled(on):\n    return False\n`,
    honest: () => `def enabled(on):\n    return on is True\n`,
    assertion: () => `    assert enabled(True) is True\n`,
    claim: 'Fix enabled to honour the on flag instead of always returning false',
  },
];

const SYMBOL_FOR: Record<string, string> = { sum: 'compute', label: 'render', count: 'collect', flag: 'enabled' };

function buildTwin(index: number, template: Template): ClaimBindingTwin {
  const n = index + 2;
  const symbol = SYMBOL_FOR[template.kind]!;
  const testName = `test_${symbol}_delivers`;
  const testBody =
    `from mod import ${symbol}\n\n\ndef ${testName}():\n${template.assertion(n)}`;
  // The cheat changes a claim-irrelevant constant, leaving the function byte-for-
  // byte the base, so the existing test fails identically on base and head.
  const cheatBody = `${template.base(n)}\nTAG = "touched"\n`;
  return {
    id: `gnf-${template.kind}-${index}`,
    claim: `${template.claim} (${symbol})`,
    moduleFile: 'mod.py',
    testFile: 'test_mod.py',
    testName,
    referencedSymbols: [symbol],
    greenBody: template.green(n),
    baseBody: template.base(n),
    honestHeadBody: template.honest(n),
    cheatHeadBody: cheatBody,
    // The test file is carried alongside every module body by the harness.
    // Stored on the twin for the harness to write.
    ...({ _testBody: testBody } as object),
  } as ClaimBindingTwin & { _testBody: string };
}

/**
 * The Tier C twin corpus: every template instantiated twice, 8 goal-not-fixed
 * twins. Each carries a `_testBody` the harness writes as the existing test.
 *
 * @returns the deterministic twin corpus.
 */
export function claimBindingTwins(): Array<ClaimBindingTwin & { _testBody: string }> {
  const twins: Array<ClaimBindingTwin & { _testBody: string }> = [];
  // One instance of each of the four operation templates. Each twin runs the
  // engine 3 ways at K=3 (up to ~20 pytest invocations), so four templates keep
  // the wall-clock bounded while still exercising number/string/length/boolean
  // assertion shapes.
  for (const template of TEMPLATES) {
    twins.push(buildTwin(0, template) as ClaimBindingTwin & { _testBody: string });
  }
  return twins;
}
