import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import {
  createFileSetRegistry,
  type FileSetRegistry,
  NothingTemporaryToRetainError,
} from "./file-set.ts";
import { createAmendFileSetTool, createDeclareFileSetTool } from "./file-set-tool.ts";
import type { GateContext } from "./gate-definition.ts";
import { fileSetGate } from "./inspection-gates.ts";
import { createMemoryWorkspace } from "./test-doubles.ts";

/**
 * Two repairs in the reach-pressure run left a probe script in the final patch: `probe-tmp.js`
 * and `tsd-check.tmp.js`. These cases hold the workflow that makes such a file a recorded,
 * checked thing. None of them reads a filename: the legitimate new source file below is called
 * `tmp-cache.js` and passes, and the leftover that fails is called `inspect.js`.
 */
let root = "";
let evidence: EvidenceRecorder;
let registry: FileSetRegistry;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-temporary-files-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "temporary-files",
    clock: createTestClock(1_700_000_000_000),
  });
  registry = createFileSetRegistry(evidence);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const base = { "lib/store.js": "export const store = () => shared;\n" };
const fixed = { "lib/store.js": "export const store = (own) => own ?? shared;\n" };

async function gateOver(current: Record<string, string>, fileSet = registry.state()) {
  const probe = createMemoryWorkspace({ base, current });
  const context: GateContext = {
    workspaceRoot: "/workspace",
    changes: await probe.changes(),
    fileSet,
    budgets: { maxChangedFiles: 12, maxAddedLines: 600 },
    probe,
  };
  if (fileSetGate.source.kind !== "inspection") throw new Error("the file-set gate inspects");
  const observation = await fileSetGate.source.inspect(context);
  return { ...fileSetGate.parse(observation), observed: JSON.parse(observation.stdout) };
}

describe("a file the agent created only to investigate", () => {
  it("passes where it was created and removed before the end", async () => {
    await registry.declare(["lib/store.js"], "model", { temporary: ["inspect.js"] });
    // Written, run and deleted: against the base, it was never there.
    const reading = await gateOver(fixed);

    expect(reading.status).toBe("passed");
    expect(reading.measures.temporaryFilesLeftBehind).toBe(0);
    expect(reading.detail).not.toContain("inspect.js");
  });

  it("blocks where it was accidentally left in the change, and names it", async () => {
    await registry.declare(["lib/store.js"], "model", { temporary: ["inspect.js"] });
    const reading = await gateOver({ ...fixed, "inspect.js": "console.log(store());\n" });

    expect(reading.status).toBe("failed");
    expect(reading.measures).toMatchObject({
      temporaryFilesLeftBehind: 1,
      // Declared, so membership is satisfied. That is why membership alone never caught it.
      filesOutsideDeclaredSet: 0,
    });
    expect(reading.detail).toContain(
      "1 file(s) recorded as temporary are still in the change: inspect.js",
    );
    expect(reading.detail).toContain("amend_file_set with `retain`");
    expect(reading.detail).not.toContain("widen the set");
    expect(reading.observed.temporaryStillPresent).toEqual(["inspect.js"]);
  });

  it("blocks one recorded as temporary partway through, by amendment", async () => {
    await registry.declare(["lib/store.js"], "model");
    await registry.amend([], "checking what tsd reports", "model", {
      temporary: ["tsd-check.tmp.js"],
    });
    const reading = await gateOver({ ...fixed, "tsd-check.tmp.js": "run();\n" });

    expect(reading.status).toBe("failed");
    expect(reading.observed.temporaryStillPresent).toEqual(["tsd-check.tmp.js"]);
  });

  it("is never deleted by the harness: the gate reports and the file stays where the model left it", async () => {
    await registry.declare(["lib/store.js"], "model", { temporary: ["inspect.js"] });
    const current = { ...fixed, "inspect.js": "console.log(1);\n" };
    await gateOver(current);
    expect(Object.keys(current)).toContain("inspect.js");
  });
});

describe("a legitimately new source file", () => {
  it("passes whatever it is called, because nothing here reads a name", async () => {
    await registry.declare(["lib/store.js", "lib/tmp-cache.js", "probe.js"], "model");
    const reading = await gateOver({
      ...fixed,
      "lib/tmp-cache.js": "export const cache = new Map();\n",
      "probe.js": "export const probe = () => true;\n",
    });

    expect(reading.status).toBe("passed");
    expect(reading.measures.temporaryFilesLeftBehind).toBe(0);
  });

  it("is still blocked where it was never declared, as before", async () => {
    await registry.declare(["lib/store.js"], "model");
    const reading = await gateOver({ ...fixed, "probe-tmp.js": "console.log(1);\n" });

    expect(reading.status).toBe("failed");
    expect(reading.measures.filesOutsideDeclaredSet).toBe(1);
  });
});

describe("a diagnostic utility kept on purpose", () => {
  it("passes once an amendment retains it, and the evidence says it was kept and why", async () => {
    await registry.declare(["lib/store.js"], "model", { temporary: ["tools/check-store.js"] });
    await registry.amend(
      [],
      "the maintainers asked for a reproduction script beside the fix",
      "model",
      { retain: ["tools/check-store.js"] },
    );
    const reading = await gateOver({ ...fixed, "tools/check-store.js": "check();\n" });

    expect(reading.status).toBe("passed");
    expect(reading.detail).toContain(
      "Kept on purpose after being recorded as temporary: tools/check-store.js " +
        "(the maintainers asked for a reproduction script beside the fix)",
    );
    expect(reading.observed.retainedTemporary).toEqual([
      expect.objectContaining({
        path: "tools/check-store.js",
        reason: "the maintainers asked for a reproduction script beside the fix",
      }),
    ]);

    // On the ledger and in front of a reviewer, not only in the gate's output.
    const amended = evidence.records().find((record) => record.type === "file-set-amended");
    expect(evidence.payloads().get(amended?.payloadDigest ?? "")).toMatchObject({
      retain: ["tools/check-store.js"],
      amendment: true,
    });
    const claim = evidence.records().find((record) => record.type === "claim");
    expect(JSON.stringify(evidence.payloads().get(claim?.payloadDigest ?? ""))).toContain(
      "recorded earlier as temporary",
    );
  });

  it("refuses to retain a path that was never temporary, since there is nothing to retain", async () => {
    await registry.declare(["lib/store.js"], "model");
    await expect(
      registry.amend([], "keep it", "model", { retain: ["lib/store.js"] }),
    ).rejects.toThrow(NothingTemporaryToRetainError);
    expect(evidence.records().some((record) => record.type === "file-set-amended")).toBe(false);
  });
});

describe("the state survives the ledger being read again", () => {
  it("replays temporary and retained paths exactly, so a resumed session holds the same debt", async () => {
    await registry.declare(["lib/store.js"], "model", { temporary: ["a.js", "b.js"] });
    await registry.amend([], "b is the reproduction the issue asked for", "model", {
      retain: ["b.js"],
    });

    const replayed = createFileSetRegistry(evidence).state();

    expect([...(replayed.temporary ?? [])]).toEqual(["a.js"]);
    expect(replayed.retained?.map((one) => one.path)).toEqual(["b.js"]);
    expect([...replayed.allowed].sort()).toEqual(["a.js", "b.js", "lib/store.js"]);
    const reading = await gateOver({ ...fixed, "a.js": "1\n", "b.js": "2\n" }, replayed);
    expect(reading.observed.temporaryStillPresent).toEqual(["a.js"]);
  });

  it("reads a ledger written before any of this as having nothing temporary", async () => {
    await registry.declare(["lib/store.js"], "model");
    const replayed = createFileSetRegistry(evidence).state();
    expect([...(replayed.temporary ?? [])]).toEqual([]);
    expect((await gateOver(fixed, replayed)).status).toBe("passed");
  });
});

describe("the tools the model calls", () => {
  it("tells the model at declaration what it now owes", async () => {
    const declare = createDeclareFileSetTool(registry, "model");
    const result = await declare.execute(
      { files: ["lib/store.js"], temporary: ["probe-tmp.js"] },
      { signal: new AbortController().signal },
    );
    expect(result.text).toContain("Temporary, to be deleted before you finish: probe-tmp.js");
    expect(result.facts).toMatchObject({ declaredFiles: 2, temporaryFiles: 1 });
  });

  it("answers a wrong retain as a result the model can act on, and records nothing", async () => {
    await registry.declare(["lib/store.js"], "model");
    const amend = createAmendFileSetTool(registry, "model");
    const result = await amend.execute(
      { retain: ["lib/store.js"], reason: "keep" },
      { signal: new AbortController().signal },
    );
    expect(result.text).toContain("was never recorded as temporary");
  });

  it("refuses an amendment that names no path at all", () => {
    const amend = createAmendFileSetTool(registry, "model");
    expect(amend.inputSchema.safeParse({ reason: "nothing" }).success).toBe(false);
    expect(amend.inputSchema.safeParse({ files: ["a.js"], reason: "needed" }).success).toBe(true);
  });
});
