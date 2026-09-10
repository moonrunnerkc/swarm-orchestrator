/**
 * Splits the test cases a pull request added into two oracles, one handed to the tool and one
 * held back from it.
 *
 * A false-green rate needs two different assertions. Hand-authoring both for four hundred tasks
 * is the corpus work this avoids: a merged pull request that adds a feature with tests already
 * contains a task (its title and body), a base commit (its parent), and a specification its own
 * maintainers wrote, which is worth more than one written by whoever wrote the tool.
 *
 * What this does not give is the independence two separately authored oracles have. Both halves
 * come from one author in one sitting and can share a blind spot. That is measurable rather than
 * arguable: `heldBackAgreementRate` over a corpus says how often the halves reach the same verdict
 * on the same patch, and a split whose halves never disagree is buying less than it appears to.
 */
export interface TestCase {
  readonly title: string;
  readonly source: string;
}

const caseStart = /(?:^|\s)(?:it|test)\s*(?:\.\s*\w+\s*)?\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

/**
 * Every top-level case with its whole body, found by matching delimiters rather than by a line
 * pattern. A brace inside a string, a template literal, a comment or a nested closure does not end
 * a case: a split that cuts one short produces halves that fail to parse, and an oracle that fails
 * to parse refuses every patch for a reason that has nothing to do with the patch.
 */
export function testCasesIn(source: string): readonly TestCase[] {
  const found: TestCase[] = [];
  caseStart.lastIndex = 0;
  let match = caseStart.exec(source);
  while (match !== null) {
    const openParen = source.indexOf("(", match.index + (match[0].startsWith("\n") ? 1 : 0));
    const end = endOfCall(source, openParen);
    if (end === -1) break;
    const from = match.index + (/^\s/.test(match[0]) ? 1 : 0);
    const trailing = source.startsWith(";", end + 1) ? end + 2 : end + 1;
    found.push({ title: match[2] ?? "", source: source.slice(from, trailing) });
    caseStart.lastIndex = trailing;
    match = caseStart.exec(source);
  }
  return found;
}

/** The index of the `)` closing the call that opens at `openParen`, or -1 where it never closes. */
function endOfCall(source: string, openParen: number): number {
  let depth = 0;
  let index = openParen;
  while (index < source.length) {
    const character = source[index] as string;
    if (character === "'" || character === '"' || character === "`") {
      index = endOfLiteral(source, index);
      if (index === -1) return -1;
    } else if (character === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index);
      index = newline === -1 ? source.length : newline;
    } else if (character === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close === -1 ? source.length : close + 1;
    } else if (character === "(" || character === "{" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0 && character === ")") return index;
    }
    index += 1;
  }
  return -1;
}

/** The index of the quote closing the literal that opens at `open`, or -1 where it never closes. */
function endOfLiteral(source: string, open: number): number {
  const quote = source[open];
  let index = open + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === quote) return index;
    index += 1;
  }
  return -1;
}

export interface TestCaseSplit {
  readonly splittable: boolean;
  readonly sealed: readonly TestCase[];
  readonly heldBack: readonly TestCase[];
}

/**
 * Deals the cases alternately rather than cutting the list in half. A suite is usually written
 * easy cases first and edge cases last, so a front/back cut hands the tool the weak half and holds
 * back the strong one, which manufactures disagreements that say more about the cut than about the
 * patch. Alternating gives both halves the same mix.
 */
export function splitTestCases(source: string): TestCaseSplit {
  const cases = testCasesIn(source);
  if (cases.length < 2) {
    return { splittable: false, sealed: cases, heldBack: [] };
  }
  return dealInBlocksOf(cases, 1);
}

/** Blocks of `size` dealt alternately: sealed takes the first block, held-back the second. */
function dealInBlocksOf(cases: readonly TestCase[], size: number): TestCaseSplit {
  const sealed = cases.filter((_, index) => Math.floor(index / size) % 2 === 0);
  const heldBack = cases.filter((_, index) => Math.floor(index / size) % 2 === 1);
  return { splittable: sealed.length > 0 && heldBack.length > 0, sealed, heldBack };
}

/**
 * How many deals a viability check pays for. Each one costs two runs of the suite on the base
 * source, on every candidate mined, so the bound is what keeps that cost from growing with the
 * size of the test file rather than a judgement about how many are enough.
 */
const dealsToTry = 3;

/**
 * The deals to try, in order, when each half has to fail on the base source before the task is
 * usable.
 *
 * The viability filter used to check that the whole added test file fails on the base, which says
 * nothing about either half: the halves are what the oracles run, and a half that passes on the
 * base accepts a patch that changes nothing, so a task dealt that way was never an opportunity to
 * catch anything. Testing each half means a half can be refused, and a refused deal is worth
 * re-dealing rather than dropping the task: which cases fail on the base is a property of the
 * suite, not of the cut, and a different cut can put a failing case on both sides.
 *
 * Blocks rather than rotations. Rotating an even-length list by one produces the same partition
 * with the halves swapped, and both halves have to fail either way, so a rotation answers the
 * same question twice. Dealing in blocks of `size` puts the first held-back case at index `size`,
 * so every size names a partition no other size can name.
 *
 * The alternating deal stays first, because its reason still holds: it is the one that gives both
 * halves the same mix of easy and edge cases. Larger blocks approach the front/back cut it exists
 * to avoid, and they are offered only where the alternating deal produced a half that specifies
 * nothing, where the choice is a cruder cut or no task at all.
 */
export function testCaseDeals(source: string): readonly TestCaseSplit[] {
  const cases = testCasesIn(source);
  const deals: TestCaseSplit[] = [];
  for (let size = 1; size <= dealsToTry && size < cases.length; size += 1) {
    deals.push(dealInBlocksOf(cases, size));
  }
  return deals;
}
