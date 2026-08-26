import { describe, expect, it } from "vitest";
import { captureInheritedChanges, changesTheRunMade } from "./inherited-changes.ts";
import type { WorkspaceChanges, WorkspaceProbe } from "./workspace-changes.ts";

function probeOver(contents: Map<string, string | null>): WorkspaceProbe {
  return {
    changes: (): Promise<WorkspaceChanges> =>
      Promise.resolve({
        baseRef: "HEAD",
        files: [...contents.keys()].map((path) => ({
          path,
          kind: "modified" as const,
          addedLines: [],
          removedLines: [],
        })),
      }),
    readCurrent: (path) => Promise.resolve(contents.get(path) ?? null),
    readBase: () => Promise.resolve(null),
  };
}

describe("what a run is answerable for", () => {
  it("drops a file that was already changed and has not been touched since", async () => {
    // The workspace this came from: an uncommitted deletion and a stray .DS_Store, neither of
    // which the model had opened, both counted against a run that had declared nothing.
    const tree = new Map<string, string | null>([
      ["package.json", null],
      [".DS_Store", "binary junk"],
    ]);
    const probe = probeOver(tree);
    const inherited = await captureInheritedChanges(probe);

    const mine = await changesTheRunMade(await probe.changes(), probe, inherited);

    expect(mine.files).toEqual([]);
  });

  it("keeps an inherited file the run went on to edit", async () => {
    const tree = new Map<string, string | null>([["notes.md", "before"]]);
    const probe = probeOver(tree);
    const inherited = await captureInheritedChanges(probe);

    tree.set("notes.md", "after");
    const mine = await changesTheRunMade(await probe.changes(), probe, inherited);

    expect(mine.files.map((file) => file.path)).toEqual(["notes.md"]);
  });

  it("keeps everything the run added, which is the ordinary case", async () => {
    const tree = new Map<string, string | null>();
    const probe = probeOver(tree);
    const inherited = await captureInheritedChanges(probe);

    tree.set("src/profile.js", "export const x = 1;");
    const mine = await changesTheRunMade(await probe.changes(), probe, inherited);

    expect(mine.files.map((file) => file.path)).toEqual(["src/profile.js"]);
  });
});
