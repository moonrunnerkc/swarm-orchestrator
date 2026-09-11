import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openRunStore } from "./run-store.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
function journal() {
  const root = mkdtempSync(join(tmpdir(), "swarm-journal-"));
  roots.push(root);
  const path = join(root, "runs.jsonl");
  const store = openRunStore(path);
  store.startRun({ runId: "one", specDigest: "spec", task: "fix", startedAt: 0 });
  return { store, path };
}
it("checks actual bytes even when file size and modification time match a cached projection", () => {
  const { store, path } = journal();
  expect(store.run("one")?.task).toBe("fix");
  const before = statSync(path);
  writeFileSync(path, readFileSync(path, "utf8").replace('"fix"', '"bad"'));
  utimesSync(path, before.atime, before.mtime);
  expect(() => store.run("one")).toThrow(/checksum/);
});
it("refuses a torn append instead of silently losing the final intent", () => {
  const { store, path } = journal();
  writeFileSync(path, `${readFileSync(path, "utf8")}{"sequence":1`);
  expect(() => store.listRuns()).toThrow(/incomplete/);
});
it("retains owner-only permissions and refuses legacy database bytes as journal entries", () => {
  const { store, path } = journal();
  expect(statSync(path).mode & 0o777).toBe(0o600);
  writeFileSync(path, "SQLite format 3\u0000");
  expect(() => store.listRuns()).toThrow(/read-only/);
});
