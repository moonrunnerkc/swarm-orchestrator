import { describe, expect, it } from "vitest";
import {
  computeLayout,
  type LayoutInput,
  narrowColumns,
  pageRows,
  visibleWindow,
} from "./layout.ts";

const busy: Omit<LayoutInput, "columns" | "rows"> = {
  planLines: 4,
  gateCount: 6,
  expanded: false,
};

const widths = [60, 80, 120, 200] as const;

describe("layout at the widths people actually use", () => {
  for (const columns of widths) {
    it(`fits inside ${columns} columns`, () => {
      const layout = computeLayout({ ...busy, columns, rows: 40 });
      expect(layout.columns).toBe(columns);
      expect(layout.contentColumns).toBeLessThan(columns);
      expect(layout.contentColumns).toBeGreaterThan(0);
    });
  }

  it("drops the optional columns below 80 rather than wrapping into noise", () => {
    expect(computeLayout({ ...busy, columns: narrowColumns - 1, rows: 40 }).narrow).toBe(true);
    expect(computeLayout({ ...busy, columns: narrowColumns, rows: 40 }).narrow).toBe(false);
    expect(computeLayout({ ...busy, columns: 60, rows: 40 }).showHeaderDetail).toBe(false);
  });

  it("gives every pane at least one row at every width", () => {
    for (const columns of widths) {
      const layout = computeLayout({ ...busy, columns, rows: 24 });
      expect(layout.actionRows).toBeGreaterThanOrEqual(1);
      expect(layout.gateRows).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("layout when the window is too short for the panes", () => {
  it("never asks for a negative row count", () => {
    for (let rows = 1; rows <= 20; rows += 1) {
      const layout = computeLayout({ ...busy, columns: 80, rows });
      expect(layout.actionRows).toBeGreaterThanOrEqual(rows >= 3 ? 1 : 0);
      expect(layout.planRows).toBeGreaterThanOrEqual(0);
      expect(layout.gateRows).toBeGreaterThanOrEqual(0);
      expect(layout.detailRows).toBeGreaterThanOrEqual(0);
      expect(pageRows(layout)).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the action stream when there is no room for anything else", () => {
    const layout = computeLayout({ ...busy, columns: 80, rows: 4 });
    expect(layout.planRows).toBe(0);
    expect(layout.gateRows).toBe(0);
    expect(layout.showHint).toBe(false);
    expect(layout.actionRows).toBeGreaterThanOrEqual(1);
  });

  // The defect this covers: each pane sized itself and the stream took what was left, with a
  // floor of one row under it, so on a short window the floor won and the total overflowed.
  it("never paints more rows than the window has, at any height or expansion", () => {
    for (let rows = 1; rows <= 60; rows += 1) {
      for (const expanded of [false, true]) {
        for (const gateCount of [0, 1, 6, 20]) {
          const layout = computeLayout({ ...busy, gateCount, columns: 80, rows, expanded });
          expect(layout.paintedRows).toBeLessThanOrEqual(rows);
        }
      }
    }
  });

  it("finds room for a detail pane only by taking it from the stream", () => {
    const collapsed = computeLayout({ ...busy, columns: 120, rows: 40 });
    const expanded = computeLayout({ ...busy, columns: 120, rows: 40, expanded: true });

    expect(expanded.detailRows).toBeGreaterThan(0);
    expect(expanded.actionRows).toBeLessThan(collapsed.actionRows);
  });

  it("gives no plan rows to a run that has not planned yet", () => {
    expect(computeLayout({ ...busy, planLines: 0, columns: 120, rows: 40 }).planRows).toBe(0);
  });
});

describe("the window a pane shows", () => {
  const rows = ["a", "b", "c", "d", "e"];

  it("follows the newest rows at a scroll of zero", () => {
    expect(visibleWindow(rows, 3, 0)).toEqual({ rows: ["c", "d", "e"], firstIndex: 2 });
  });

  it("holds still further back as the scroll grows", () => {
    expect(visibleWindow(rows, 3, 2)).toEqual({ rows: ["a", "b", "c"], firstIndex: 0 });
  });

  it("stops at the oldest row rather than scrolling past it", () => {
    expect(visibleWindow(rows, 3, 99)).toEqual({ rows: ["a"], firstIndex: 0 });
  });

  it("shows everything when the pane is taller than the list", () => {
    expect(visibleWindow(rows, 10, 0).rows).toEqual(rows);
  });

  it("shows nothing for an empty list without throwing", () => {
    expect(visibleWindow([], 5, 3)).toEqual({ rows: [], firstIndex: 0 });
  });
});
