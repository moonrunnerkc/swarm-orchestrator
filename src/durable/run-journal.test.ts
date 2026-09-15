import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { openRunJournal } from "./run-journal.ts";
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

it("does not bless corrupted bytes introduced between a checked read and its append", () => {
  const { path } = journal();
  const opened = openRunJournal(
    path,
    () => ({ runs: {}, steps: {}, leases: {}, budgets: {}, reservations: {}, approvals: {} }),
    (projection) => z.record(z.string(), z.record(z.string(), z.unknown())).parse(projection),
  );
  expect(() =>
    opened.update("interference", () => {
      writeFileSync(path, readFileSync(path, "utf8").replace('"fix"', '"bad"'));
    }),
  ).toThrow(/changed during|checksum/);
  expect(readFileSync(path, "utf8")).toContain('"bad"');
  expect(() => opened.read()).toThrow(/checksum/);
});

it("observes a different process appending an administrative abort", () => {
  const { store, path } = journal();
  expect(store.run("one")?.state).toBe("running");
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {openRunStore} from ${JSON.stringify(new URL("./run-store.ts", import.meta.url).href)}; const store=openRunStore(${JSON.stringify(path)}); store.abortRun('one','cross-process cancellation',1); store.close();`,
    ],
    { env: harnessChildEnvironment().variables },
  );
  expect(store.run("one")).toMatchObject({
    state: "aborted",
    detail: "cross-process cancellation",
  });
});

it("refuses removal of a complete previously verified budget event", () => {
  const { store, path } = journal();
  const prefix = readFileSync(path);
  store.setBudget({ runId: "one", tokens: 100 });
  expect(store.remainingTokens("one")).toBe(100);
  writeFileSync(path, prefix);
  expect(() => store.remainingTokens("one")).toThrow(/previously verified prefix/);
  expect(readFileSync(path)).toEqual(prefix);
});

it("refuses invalid UTF-8 instead of hashing a decoded replacement character", () => {
  const { path } = journal();
  const encoded = {
    sequence: 0,
    previousHash: "genesis",
    operation: "fixture",
    projection: { items: { one: { value: "\uFFFD" } } },
  };
  const valid = Buffer.from(
    `${JSON.stringify({ ...encoded, hash: digestOfBytes(JSON.stringify(encoded)) })}\n`,
  );
  const index = valid.indexOf(Buffer.from("\uFFFD"));
  const malformed = Buffer.concat([
    valid.subarray(0, index),
    Buffer.from([255]),
    valid.subarray(index + 3),
  ]);
  const filename = `${path}.invalid`;
  writeFileSync(filename, malformed);
  const opened = openRunJournal(
    filename,
    () => ({ items: {} }),
    (projection) => z.record(z.string(), z.record(z.string(), z.unknown())).parse(projection),
  );
  expect(() => opened.read()).toThrow("invalid UTF-8");
  expect(readFileSync(filename)).toEqual(malformed);
});
