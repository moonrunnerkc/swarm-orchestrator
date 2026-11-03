import { describe, expect, it } from "vitest";
import { diffCap, stateBlock } from "./conversation.ts";

const removed = (count: number, what: string) =>
  Array.from({ length: count }, (_, at) => `-    ${what} line ${at}: ${"x".repeat(80)}`);
const added = (count: number, what: string) =>
  Array.from({ length: count }, (_, at) => `+    ${what} line ${at}: ${"y".repeat(80)}`);
const header = (path: string, created = false) => [
  `diff --git a/${path} b/${path}`,
  ...(created ? ["new file mode 100644"] : []),
  "index 2b18d75..9578c59 100644",
  created ? "--- /dev/null" : `--- a/${path}`,
  `+++ b/${path}`,
];

/**
 * The shape of the diff t6 step 12 read (session 20261103T213819-76ab1e): both modules moved
 * into a new package and a re-export shim written at each old path. Cut from the middle of the
 * whole diff, only the first file's header survived, and the second shim read as the first's.
 */
const storeShim = "+from tracemantle.history.history_store import *";
const diff = [
  ...header("src/tracemantle/core/history_io.py"),
  "@@ -1,276 +1,2 @@",
  ...removed(276, "history_io"),
  "+from tracemantle.history.history_io import *",
  "+__all__ = ['load_ledger']",
  ...header("src/tracemantle/history/__init__.py", true),
  ...header("src/tracemantle/history/history_io.py", true),
  "@@ -0,0 +1,276 @@",
  ...added(276, "history_io"),
  ...header("src/tracemantle/history/history_store.py", true),
  "@@ -0,0 +1,96 @@",
  ...added(96, "history_store"),
  ...header("src/tracemantle/history_store.py"),
  "@@ -1,96 +1,2 @@",
  ...removed(96, "history_store"),
  storeShim,
  "+__all__ = ['HistoryStore']",
].join("\n");

const shownDiff = () => {
  const block = stateBlock({ status: "", diff, findings: null, notice: null });
  return block.slice(block.indexOf("Diff against the base:\n") + "Diff against the base:\n".length);
};

describe("the diff a turn shows", () => {
  it("names every changed file when the diff is over its cap", () => {
    const shown = shownDiff();
    for (const path of [
      "src/tracemantle/core/history_io.py",
      "src/tracemantle/history/__init__.py",
      "src/tracemantle/history/history_io.py",
      "src/tracemantle/history/history_store.py",
      "src/tracemantle/history_store.py",
    ]) {
      expect(shown).toContain(`diff --git a/${path} b/${path}`);
    }
  });

  it("shows a file's change under its own header, never under another file's", () => {
    const lines = shownDiff().split("\n");
    const at = lines.indexOf(storeShim);
    expect(at).toBeGreaterThan(-1);
    const owner = lines
      .slice(0, at)
      .reverse()
      .find((line) => line.startsWith("diff --git "));
    expect(owner).toBe(
      "diff --git a/src/tracemantle/history_store.py b/src/tracemantle/history_store.py",
    );
  });

  it("stays within the cap, and leaves a diff under it as it is", () => {
    expect(Buffer.byteLength(shownDiff())).toBeLessThanOrEqual(diffCap);
    const small = header("a.ts").concat(["@@ -1 +1 @@", "-a", "+b"]).join("\n");
    const block = stateBlock({ status: "", diff: small, findings: null, notice: null });
    expect(block.endsWith(small)).toBe(true);
  });
});
