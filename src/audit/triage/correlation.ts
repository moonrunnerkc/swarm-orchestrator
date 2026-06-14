// Correlation primitives for the triage surface. Phase 0 uses these to
// measure whether a distant-supervision label (a PR proven retrospectively
// bad) co-occurs with each cheat category the detectors fire. The math is
// the phi coefficient (Matthews correlation for two binary variables) over
// a 2x2 contingency table, plus the raw firing rates and the lift, so the
// report can show both the effect size and the direction.
//
// Pure and dependency-free so the same functions back the Phase 0 script,
// the label model's labeling-function accuracy estimates, and the tests.

/**
 * A 2x2 contingency table. Rows are the label (bad vs not-bad), columns are
 * the event (category fired vs not). `n11` is bad-and-fired, `n10` is
 * bad-and-not-fired, `n01` is notBad-and-fired, `n00` is notBad-and-not-fired.
 */
export interface ContingencyTable {
  readonly n11: number;
  readonly n10: number;
  readonly n01: number;
  readonly n00: number;
}

/** One category's association with the label, with the table it came from. */
export interface CategoryCorrelation {
  readonly category: string;
  readonly table: ContingencyTable;
  /** Firing rate among labeled-bad rows: n11 / (n11 + n10). */
  readonly rateBad: number;
  /** Firing rate among not-bad rows: n01 / (n01 + n00). */
  readonly rateNotBad: number;
  /** rateBad / rateNotBad. Infinity when it fires only on bad rows, NaN when
   *  neither group fires it. A lift near 1 means the label tells you nothing. */
  readonly lift: number;
  /** Phi coefficient in [-1, 1]. Positive means the category fires more on
   *  bad rows; 0 means independent; negative means it fires more on clean. */
  readonly phi: number;
}

/**
 * Phi coefficient for a 2x2 table. Returns 0 when any margin is empty,
 * because a constant row or column carries no association (the usual
 * convention; the standard formula would divide by zero).
 */
export function phiCoefficient(table: ContingencyTable): number {
  const { n11, n10, n01, n00 } = table;
  const rowBad = n11 + n10;
  const rowNotBad = n01 + n00;
  const colFired = n11 + n01;
  const colNotFired = n10 + n00;
  if (rowBad === 0 || rowNotBad === 0 || colFired === 0 || colNotFired === 0) {
    return 0;
  }
  const numerator = n11 * n00 - n10 * n01;
  const denominator = Math.sqrt(rowBad * rowNotBad * colFired * colNotFired);
  return numerator / denominator;
}

/** A row in the correlation input: whether the PR is labeled bad, and the set
 *  of cheat categories the auditor fired on it. */
export interface LabeledRow {
  readonly bad: boolean;
  readonly firedCategories: ReadonlySet<string>;
}

/**
 * Build the 2x2 table for one category over the labeled rows.
 */
export function contingencyFor(rows: readonly LabeledRow[], category: string): ContingencyTable {
  let n11 = 0;
  let n10 = 0;
  let n01 = 0;
  let n00 = 0;
  for (const row of rows) {
    const fired = row.firedCategories.has(category);
    if (row.bad && fired) n11 += 1;
    else if (row.bad && !fired) n10 += 1;
    else if (!row.bad && fired) n01 += 1;
    else n00 += 1;
  }
  return { n11, n10, n01, n00 };
}

/**
 * Correlate every category against the label over the labeled rows. Returns
 * one entry per category in the order given, sorted by descending phi so the
 * strongest associations lead.
 */
export function correlateCategories(
  rows: readonly LabeledRow[],
  categories: readonly string[],
): CategoryCorrelation[] {
  const out = categories.map((category) => {
    const table = contingencyFor(rows, category);
    const rowBad = table.n11 + table.n10;
    const rowNotBad = table.n01 + table.n00;
    const rateBad = rowBad === 0 ? 0 : table.n11 / rowBad;
    const rateNotBad = rowNotBad === 0 ? 0 : table.n01 / rowNotBad;
    const lift = rateNotBad === 0 ? (rateBad === 0 ? Number.NaN : Number.POSITIVE_INFINITY) : rateBad / rateNotBad;
    return {
      category,
      table,
      rateBad,
      rateNotBad,
      lift,
      phi: phiCoefficient(table),
    };
  });
  out.sort((a, b) => b.phi - a.phi);
  return out;
}

/**
 * The aggregate "any category fired" association: collapse every category
 * into a single fired/not-fired event per row, then correlate. This is the
 * headline number for whether the label predicts that the auditor fires at all.
 */
export function correlateAnyFired(rows: readonly LabeledRow[]): CategoryCorrelation {
  const collapsed: LabeledRow[] = rows.map((row) => ({
    bad: row.bad,
    firedCategories: row.firedCategories.size > 0 ? new Set(['*any*']) : new Set<string>(),
  }));
  const [only] = correlateCategories(collapsed, ['*any*']);
  return only;
}
