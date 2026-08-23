/**
 * How many rows each pane gets at a given terminal size, and how many cells a row has to
 * write in. Pure arithmetic, so the sizes a naive implementation only discovers on a small
 * window are a table test here (`layout.test.ts` runs 60, 80, 120 and 200 columns, and every
 * height from one row up).
 */

/** Below this the optional columns come off: the header detail, the gate detail, the hint words. */
export const narrowColumns = 80;

/** Under this many rows there is no room for anything but the header, one row, and the status. */
const minimumRows = 6;

/** The plan is context, not the work, so it never takes more than this however long it is. */
const planRowCap = 3;

/** An expanded payload is worth a few rows and never worth the whole screen. */
const detailRowCap = 8;

const indent = "  ";

export interface ScreenSize {
  readonly columns: number;
  readonly rows: number;
}

export interface LayoutInput extends ScreenSize {
  readonly planLines: number;
  readonly gateCount: number;
  /** True while a row is expanded, which needs rows of its own to show the payload in. */
  readonly expanded: boolean;
}

export interface Layout {
  readonly columns: number;
  /** Cells a pane row may write, after the indent and with a cell kept back for the cursor. */
  readonly contentColumns: number;
  /** Below `narrowColumns`: the same information, fewer columns, never wrapped into noise. */
  readonly narrow: boolean;
  readonly showLabels: boolean;
  readonly showHint: boolean;
  readonly showHeaderDetail: boolean;
  readonly planRows: number;
  readonly actionRows: number;
  readonly gateRows: number;
  readonly detailRows: number;
  /** Every row this layout will paint, labels included. Never more than the window has. */
  readonly paintedRows: number;
}

/**
 * Allocated in priority order out of one budget, rather than each pane sizing itself and the
 * total being checked afterwards: the action stream takes its floor first and the rest back
 * at the end, so no pane can be given rows the window does not have.
 */
export function computeLayout(input: LayoutInput): Layout {
  const columns = Math.max(1, input.columns);
  const rows = Math.max(1, input.rows);
  const narrow = columns < narrowColumns;
  const contentColumns = Math.max(1, columns - indent.length - 1);

  const cramped = rows < minimumRows;
  const showHint = !cramped && rows >= 8;
  const showHeaderDetail = !cramped && rows >= 12 && !narrow;
  const showLabels = !cramped && rows >= 10;

  const header = 1 + (showHeaderDetail ? 1 : 0);
  // A window of one row is the header and nothing else: the status is the first thing to go,
  // because a screen that painted more rows than it has scrolls its own top away.
  const trailer = rows < 2 ? 0 : 1 + (showHint ? 1 : 0);
  let budget = Math.max(0, rows - header - trailer);

  if (cramped) {
    return {
      columns,
      contentColumns,
      narrow,
      showLabels: false,
      showHint: false,
      showHeaderDetail: false,
      planRows: 0,
      actionRows: budget,
      gateRows: 0,
      detailRows: 0,
      paintedRows: header + budget + trailer,
    };
  }

  const label = showLabels ? 1 : 0;
  // The stream's floor comes off first: one row of it and its label are never given away.
  const floor = Math.min(budget, label + 1);
  budget -= floor;

  const detailRows = input.expanded ? Math.min(detailRowCap, share(budget, 3)) : 0;
  budget -= detailRows === 0 ? 0 : Math.min(budget, detailRows + label);

  const gateRows = input.gateCount === 0 ? 0 : Math.min(input.gateCount, share(budget - label, 2));
  budget -= gateRows === 0 ? 0 : Math.min(budget, gateRows + label);

  const planRows =
    input.planLines === 0 ? 0 : Math.min(input.planLines, planRowCap, budget - label);
  budget -= planRows <= 0 ? 0 : Math.min(budget, planRows + label);

  const actionRows = Math.max(0, floor - label) + Math.max(0, budget);
  const painted =
    header +
    trailer +
    actionRows +
    Math.min(label, floor) +
    (planRows > 0 ? planRows + label : 0) +
    (gateRows > 0 ? gateRows + label : 0) +
    (detailRows > 0 ? detailRows + label : 0);

  return {
    columns,
    contentColumns,
    narrow,
    showLabels,
    showHint,
    showHeaderDetail,
    planRows: Math.max(0, planRows),
    actionRows,
    gateRows,
    detailRows,
    paintedRows: painted,
  };
}

/** A fraction of what is left, never negative and never the whole of it. */
function share(available: number, divisor: number): number {
  return Math.max(0, Math.floor(available / divisor));
}

/** What a page key moves by: one screenful of the stream, less a row of overlap to read across. */
export function pageRows(layout: Layout): number {
  return Math.max(1, layout.actionRows - 1);
}

/**
 * The window of a list a pane shows, newest last. `scrollBack` counts rows back from the
 * newest, so zero follows the tail and anything larger holds still while the run continues.
 */
export function visibleWindow<T>(
  rows: readonly T[],
  visibleRows: number,
  scrollBack: number,
): { readonly rows: readonly T[]; readonly firstIndex: number } {
  const capped = Math.min(scrollBack, Math.max(0, rows.length - 1));
  const end = Math.max(0, rows.length - capped);
  const start = Math.max(0, end - visibleRows);
  return { rows: rows.slice(start, end), firstIndex: start };
}
