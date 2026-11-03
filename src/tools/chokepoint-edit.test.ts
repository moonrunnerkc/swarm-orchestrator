import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { createChokepoint } from "./chokepoint.ts";
import { createPolicyGuard, defaultShellAllowlist } from "./policy-guard.ts";

let root = "";
let workspace = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "chokepoint-edit-"));
  workspace = join(root, "workspace");
  await writeFile(join(root, "outside.txt"), "outside\n");
  await mkdir(workspace);
  await writeFile(join(workspace, "a.ts"), "const a = 1;\n");
  evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "s",
    now: () => 1,
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const chokepoint = () =>
  createChokepoint({
    guard: createPolicyGuard({
      workspaceRoot: workspace,
      homeDir: homedir(),
      shellAllowlist: defaultShellAllowlist,
      deniedRoots: [join(root, "sessions")],
      childHomeDir: join(root, "child-home"),
    }),
    evidence,
    approval: "auto",
    confirm: null,
    timeoutMs: 30_000,
  });

const replace = (path: string, search: string, value: string) =>
  ({ mode: "edit", path, pairs: [{ search, replace: value }] }) as const;

describe("an edit through the chokepoint", () => {
  it("applies it and records the request before and the outcome after, with both digests", async () => {
    const outcome = await chokepoint().edit(replace("a.ts", "= 1", "= 2"));
    expect(outcome).toMatchObject({ decision: "allowed", exitCode: 0 });
    expect(outcome.output).toBe("edited a.ts, 1 replacement; it now has 1 line");
    expect(await readFile(join(workspace, "a.ts"), "utf8")).toBe("const a = 2;\n");
    expect(evidence.records().map((record) => record.type)).toEqual(["tool-call", "tool-call"]);
  });

  it("refuses the paths a command is refused: outside the workspace, credentials, the session store", async () => {
    const tried = [
      { mode: "write", path: "../outside.txt", content: "x\n" },
      { mode: "write", path: join(root, "outside.txt"), content: "x\n" },
      { mode: "write", path: ".env", content: "KEY=x\n" },
      { mode: "write", path: ".git/config", content: "x\n" },
      { mode: "write", path: join(root, "sessions", "s", "x"), content: "x\n" },
    ] as const;
    for (const edit of tried) {
      expect([edit.path, (await chokepoint().edit(edit)).decision]).toEqual([edit.path, "denied"]);
    }
    expect(await readFile(join(root, "outside.txt"), "utf8")).toBe("outside\n");
  });

  it("leaves the file as it was when a SEARCH part does not match exactly once", async () => {
    const outcome = await chokepoint().edit(replace("a.ts", "const b", "const c"));
    expect(outcome).toMatchObject({ decision: "failed", exitCode: null });
    expect(outcome.output).toContain("not applied: the SEARCH part matches nothing");
    expect(await readFile(join(workspace, "a.ts"), "utf8")).toBe("const a = 1;\n");
  });
});
