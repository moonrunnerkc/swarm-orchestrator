import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { createFileSetRegistry, writeRefusal } from "../gates/file-set.ts";
import { createToolChokepoint } from "./chokepoint.ts";
import { createLedgerChokepointRecorder } from "./chokepoint-record.ts";
import { createSandbox, defaultShellAllowlist } from "./sandbox.ts";
import { createWorkspaceTools } from "./workspace-tools.ts";

/**
 * The shape of a campaign run that fixed its defect in the first turn and was escalated
 * anyway: the edit landed before any declaration, a later declaration could not clear it,
 * and the amendment that could came one attempt too late. The tools now refuse the edit
 * where the model can act on the refusal.
 */
let root = "";
let workspace = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-declared-writes-"));
  workspace = join(root, "repo");
  await writeFile(join(root, "placeholder"), "");
  await rm(join(root, "placeholder"));
  await (await import("node:fs/promises")).mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src/Codec.ts"), "export const serialize = (v: unknown) => v;\n");
  evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "declared-writes",
    clock: createTestClock(),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function toolsFor(registry: ReturnType<typeof createFileSetRegistry>) {
  const sandbox = createSandbox({
    workspaceRoot: workspace,
    homeDir: root,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [],
  });
  const definitions = createWorkspaceTools(sandbox, (path) => writeRefusal(registry.state(), path));
  return createToolChokepoint({
    definitions,
    sandbox,
    confirm: () => Promise.resolve(false),
    recorder: createLedgerChokepointRecorder(evidence),
  });
}

describe("a write before any declaration", () => {
  it("is refused at the tool, with the remedy, and the file is untouched", async () => {
    const registry = createFileSetRegistry(evidence);
    const invoker = toolsFor(registry);

    const outcome = await invoker.invoke({
      callId: "c1",
      toolName: "edit",
      input: { path: "src/Codec.ts", find: "=> v;", replace: "=> String(v);" },
      provenance: "model",
    });

    expect(outcome.failed).toBe(true);
    expect(outcome.output).toContain("no file set is declared yet");
    expect(outcome.output).toContain("declare_file_set");
    expect(await readFile(join(workspace, "src/Codec.ts"), "utf8")).toContain("=> v;");
    // Refused before anything ran, so the ledger holds no write for the gate to find out of order.
    expect(registry.state().editedBeforeAuthorized).toEqual([]);
  });

  it("goes ahead once the file is declared, and is refused outside the set with the amendment named", async () => {
    const registry = createFileSetRegistry(evidence);
    const invoker = toolsFor(registry);
    await registry.declare(["src/Codec.ts"], "fixture");

    const inside = await invoker.invoke({
      callId: "c2",
      toolName: "edit",
      input: { path: "./src/Codec.ts", find: "=> v;", replace: "=> String(v);" },
      provenance: "model",
    });
    const outside = await invoker.invoke({
      callId: "c3",
      toolName: "write",
      input: { path: "src/Other.ts", content: "export const other = 1;\n" },
      provenance: "model",
    });

    expect(inside.failed).toBe(false);
    expect(await readFile(join(workspace, "src/Codec.ts"), "utf8")).toContain("String(v)");
    expect(outside.failed).toBe(true);
    expect(outside.output).toContain("outside the declared file set (src/Codec.ts)");
    expect(outside.output).toContain("amend_file_set");
  });
});

describe("writeRefusal", () => {
  it("answers null for a declared path however it is spelled", () => {
    const state = {
      declared: ["src/a.ts"],
      amendments: [],
      allowed: new Set(["src/a.ts"]),
      wasDeclared: true,
      editedBeforeAuthorized: [],
    };
    expect(writeRefusal(state, "src/a.ts")).toBeNull();
    expect(writeRefusal(state, "./src/a.ts")).toBeNull();
    expect(writeRefusal(state, "src/b.ts")).toContain("amend_file_set");
  });
});
