/**
 * The numbers invariant 7 ratchets on, counted from file text rather than inferred from a
 * pass or fail. Counting is per test file so an exemption can be applied to one file
 * without blinding the comparison for every other file.
 */

const testFileNames: readonly RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.go$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
  /(^|\/)[^/]+_spec\.rb$/,
];

const testDirectorySegments: readonly RegExp[] = [/(^|\/)(tests?|__tests__|spec|specs)(\/|$)/];

const assertionPatterns: readonly RegExp[] = [
  /\bexpect\s*\(/,
  /\bassert\b/,
  /\bshould\b/,
  /\bt\.Fatal[f]?\s*\(/,
  /\bt\.Error[f]?\s*\(/,
  /\bExpect\s*\(/,
];

/**
 * An exact-match matcher pins its subject's value, so it is at least as strong as any
 * looser matcher on that subject. Consolidating three loose assertions into one exact one
 * reads as a two-assertion drop without this, which gated real feature work in v12.
 */
const exactMatcher =
  /\.\s*(toBe|toEqual|toStrictEqual|toMatchObject|toMatchInlineSnapshot|toMatchSnapshot)\s*\(/;

const testDeclarationPatterns: readonly RegExp[] = [
  // A skipped test is still a declared test, so it stays in this count and shows up as a
  // skip marker instead. Both numbers then move, and either one rejects the retry.
  /(^|[^.\w])x?(it|test)\s*(\.\s*(each|concurrent|sequential|skip|todo|failing|only)\s*(\([^)]*\))?\s*)?\(/,
  /\bdef\s+test_\w*\s*\(/,
  /\bfunc\s+Test\w+\s*\(/,
  /#\[\s*test\s*\]/,
];

const skipMarkerPatterns: readonly RegExp[] = [
  /\b(it|test|describe|context|suite)\s*\.\s*(skip|todo|failing)\s*\(/,
  /\bx(it|describe|test|context)\s*\(/,
  /@pytest\.mark\.(skip|skipif|xfail)/,
  /\bunittest\.skip\b/,
  /\bt\.Skip(Now|f)?\s*\(/,
  /#\[\s*ignore\s*(\([^)]*\))?\s*\]/,
];

export interface TestFileMeasures {
  readonly tests: number;
  readonly assertions: number;
  readonly skips: number;
  /** Subjects that carry an exact-match assertion, for the re-specification allowance. */
  readonly exactSubjects: readonly string[];
  /**
   * How many assertions each subject carries. Consolidating four assertions on one subject
   * into a single exact-match assertion is a strengthening, and telling that apart from a
   * strip needs the per-subject count, not just the file total.
   */
  readonly assertionsBySubject: Readonly<Record<string, number>>;
}

export const emptyTestFileMeasures: TestFileMeasures = {
  tests: 0,
  assertions: 0,
  skips: 0,
  exactSubjects: [],
  assertionsBySubject: {},
};

export function isTestFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    testFileNames.some((pattern) => pattern.test(normalized)) ||
    testDirectorySegments.some((pattern) => pattern.test(normalized))
  );
}

/**
 * Source a coverage measure may sensibly speak about. A markdown file whose fenced block
 * contains an `if (` is not test-reachable source, and counting it as uncovered would put
 * noise into a number the ratchet blocks on.
 */
export function isTestReachableSource(path: string): boolean {
  if (isTestFile(path)) {
    return false;
  }
  return /\.(m|c)?(ts|js)x?$|\.py$|\.go$|\.rs$|\.rb$|\.java$|\.kt$/.test(
    path.replaceAll("\\", "/"),
  );
}

/** A deleted file measures as zero rather than as absent, which is what makes deletion visible. */
export function measureTestFile(text: string | null): TestFileMeasures {
  if (text === null) {
    return emptyTestFileMeasures;
  }

  let tests = 0;
  let assertions = 0;
  let skips = 0;
  const exactSubjects = new Set<string>();
  const assertionsBySubject: Record<string, number> = {};

  for (const rawLine of text.split("\n")) {
    const line = stripComment(rawLine);
    if (line.trim().length === 0) {
      continue;
    }
    if (skipMarkerPatterns.some((pattern) => pattern.test(line))) {
      skips += 1;
    }
    if (testDeclarationPatterns.some((pattern) => pattern.test(line))) {
      tests += 1;
    }
    if (!assertionPatterns.some((pattern) => pattern.test(line))) {
      continue;
    }
    assertions += 1;
    const subject = assertionSubject(line);
    if (subject === null) {
      continue;
    }
    assertionsBySubject[subject] = (assertionsBySubject[subject] ?? 0) + 1;
    if (exactMatcher.test(line)) {
      exactSubjects.add(subject);
    }
  }

  return {
    tests,
    assertions,
    skips,
    exactSubjects: [...exactSubjects].sort(),
    assertionsBySubject,
  };
}

/**
 * The subject of an `expect(X)` assertion, whitespace-normalized, so a removed loose
 * assertion and an added exact one on the same subject can be matched. Null for assertion
 * styles with no parenthesized subject, which then never count as re-specified.
 */
function assertionSubject(line: string): string | null {
  const match = /\bexpect\s*\(\s*([\s\S]+?)\s*\)\s*\./i.exec(line);
  const subject = match?.[1];
  return subject === undefined ? null : subject.replaceAll(/\s+/g, " ").trim();
}

/**
 * Line comments only. A block comment spanning lines is left alone rather than
 * half-parsed, and a `#` that opens a Rust attribute or a shebang is not a comment.
 */
function stripComment(line: string): string {
  const marker = /(^|\s)(\/\/|#(?![[!]))/.exec(line);
  return marker === null ? line : line.slice(0, marker.index);
}
