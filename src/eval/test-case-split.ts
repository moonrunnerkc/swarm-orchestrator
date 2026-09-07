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
  return {
    splittable: true,
    sealed: cases.filter((_, index) => index % 2 === 0),
    heldBack: cases.filter((_, index) => index % 2 === 1),
  };
}
