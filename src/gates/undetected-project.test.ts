import { describe, expect, it } from "vitest";
import { assembleGates } from "./default-gates.ts";
import type { GateContext } from "./gate-definition.ts";
import type { ChangedFile } from "./workspace-changes.ts";

const undetected = {
  types: [],
  manifests: [],
  nodeScripts: [],
  nodeScriptCommands: {},
  pythonTools: [],
};

function contextOver(files: readonly ChangedFile[]): GateContext {
  return {
    workspaceRoot: "/work/repo",
    changes: { baseRef: "HEAD", files },
    fileSet: { declared: null, amendments: [] },
    budgets: { maxChangedFiles: 12, maxAddedLines: 400 },
    probe: {
      changes: () => Promise.resolve({ baseRef: "HEAD", files }),
      readCurrent: () => Promise.resolve(null),
      readBase: () => Promise.resolve(null),
    },
  } as unknown as GateContext;
}

const changedFile: ChangedFile = {
  path: "profile_store.py",
  kind: "added",
  addedLines: [],
  removedLines: [],
};

async function readingFor(id: string, files: readonly ChangedFile[]) {
  const gate = assembleGates(undetected, {}).find((candidate) => candidate.id === id);
  if (gate?.source.kind !== "inspection") throw new Error(`${id} is not an inspection gate`);
  const observation = await gate.source.inspect(contextOver(files));
  return gate.parse(observation);
}

describe("a workspace no manifest describes", () => {
  it("fails over a change, because nothing ran over the code it wrote", async () => {
    // A run wrote 142 lines of Python here and went green: with no manifest there was no
    // language gate to assemble, not-applicable was read as satisfied, and the file it shipped
    // could not even be imported. Not measured is not a pass.
    for (const id of ["typecheck", "lint", "format", "tests"]) {
      const reading = await readingFor(id, [changedFile]);

      expect(reading.status, id).toBe("failed");
      expect(reading.detail, id).toContain("Add the manifest");
    }
  });

  it("stands down over a tree nothing touched, where there is nothing to measure", async () => {
    for (const id of ["typecheck", "lint", "format", "tests"]) {
      expect((await readingFor(id, [])).status, id).toBe("not-applicable");
    }
  });
});
