import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { retainActionArtifacts } from "./artifacts.ts";

it("retains bounded diagnostics and names omitted evidence without changing the original", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-action-retention-"));
  try {
    await mkdir(join(root, "bundle"));
    for (const name of ["report.json", "summary.md", "diagnostic.txt"])
      await writeFile(join(root, name), "fixture");
    await writeFile(join(root, "bundle/large.json"), "x".repeat(8_000_001));
    const result = retainActionArtifacts(root);
    expect(result.complete).toBe(false);
    expect((await readFile(join(root, "bundle/large.json"))).length).toBe(8_000_001);
    const manifest = JSON.parse(await readFile(join(result.destination, "retention.json"), "utf8"));
    expect(manifest.inventory).toContainEqual(
      expect.objectContaining({ path: "bundle/large.json", retained: false }),
    );
    expect(await readFile(join(result.destination, "summary.md"), "utf8")).toBe("fixture");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
