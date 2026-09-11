import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { importLegacyRunStore } from "./legacy-run-store.ts";
import { openRunStore } from "./run-store.ts";

it("preserves legacy bytes and does not promote bookkeeping to completed effects", () => {
  const root = mkdtempSync(join(tmpdir(), "swarm-legacy-fixture-"));
  try {
    const source = join(root, "legacy.db");
    const target = join(root, "runs.jsonl");
    const database = new DatabaseSync(source);
    database.exec(
      "CREATE TABLE runs(run_id TEXT, spec_digest TEXT, task TEXT, state TEXT, started_at INTEGER, ended_at INTEGER); CREATE TABLE steps(run_id TEXT, step_id TEXT, kind TEXT, idempotency_key TEXT, state TEXT, updated_at INTEGER); INSERT INTO runs VALUES('one','spec','fix','finished',0,1); INSERT INTO steps VALUES('one','write','write','operation','done',1);",
    );
    database.close();
    const before = readFileSync(source);
    expect(importLegacyRunStore(source, target)).toBe(1);
    expect(importLegacyRunStore(source, target)).toBe(0);
    expect(readFileSync(source)).toEqual(before);
    expect(openRunStore(target).run("one")?.state).toBe("aborted");
    expect(openRunStore(target).steps("one")[0]?.state).toBe("failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("refuses collisions before changing an existing journal run", () => {
  const root = mkdtempSync(join(tmpdir(), "swarm-legacy-collision-"));
  try {
    const source = join(root, "legacy.db");
    const target = join(root, "runs.jsonl");
    const database = new DatabaseSync(source);
    database.exec(
      "CREATE TABLE runs(run_id TEXT, spec_digest TEXT, task TEXT, state TEXT, started_at INTEGER, ended_at INTEGER); CREATE TABLE steps(run_id TEXT, step_id TEXT, kind TEXT, idempotency_key TEXT, state TEXT, updated_at INTEGER); INSERT INTO runs VALUES('one','spec','old task','finished',0,1);",
    );
    database.close();
    openRunStore(target).startRun({
      runId: "one",
      specDigest: "new-spec",
      task: "new task",
      startedAt: 2,
    });
    const before = readFileSync(target);
    expect(() => importLegacyRunStore(source, target)).toThrow(/conflicts/);
    expect(readFileSync(target)).toEqual(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
