import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unpackArchive } from "../local-campaign/archive.mjs";
import { packedFile, packGoals } from "./pack-goals.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("packing goal packages", () => {
  it("keeps only the files a goal is defined by and restores them byte for byte", async () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-pack-"));
    roots.push(root);
    const goal = join(root, "demo-bugfix-x");
    mkdirSync(join(goal, "conditions"), { recursive: true });
    const files = {
      "goal.json": "{}\n",
      "task.md": "Fix it.\n",
      "contract.json": "{}\n",
      "reference.patch": "diff --git a/x b/x\n",
      "conditions/correct.patch": "diff --git a/x b/x\n",
      "validation.json": "{}\n",
      "notes.txt": "authoring notes\n",
    };
    for (const [path, content] of Object.entries(files)) writeFileSync(join(goal, path), content);
    const { compressed, manifest } = packGoals(["demo-bugfix-x"], root);
    const out = join(root, "packed");
    mkdirSync(out);
    writeFileSync(join(out, "archive.json.br"), compressed);
    writeFileSync(join(out, "archive-manifest.json"), JSON.stringify(manifest));
    expect(manifest.files).toBe(5);
    const restored = await unpackArchive(out);
    try {
      expect(readFileSync(join(restored.directory, "demo-bugfix-x/task.md"), "utf8")).toBe(
        "Fix it.\n",
      );
    } finally {
      await restored.dispose();
    }
    expect(packedFile("validation.json")).toBe(false);
    expect(packedFile("conditions/../x.patch")).toBe(false);
  });
});
