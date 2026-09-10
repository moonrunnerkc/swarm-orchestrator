import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvedPath } from "./resolved-path.ts";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "swarm-resolved-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("resolvedPath", () => {
  /**
   * A coverage report names the file the process opened and the harness names the directory it
   * cloned into. On macOS the system scratch directory is reached through a symlink, so those are
   * the same file under two spellings and comparing them as text puts every file outside the tree.
   */
  it("gives one answer for a file reached through a symlink and directly", async () => {
    await writeFile(join(directory, "thing.js"), "export const x = 1;\n");
    await symlink(directory, join(directory, "..", "swarm-resolved-link"));
    try {
      expect(resolvedPath(join(directory, "..", "swarm-resolved-link", "thing.js"))).toBe(
        resolvedPath(join(directory, "thing.js")),
      );
    } finally {
      await rm(join(directory, "..", "swarm-resolved-link"), { force: true });
    }
  });

  // A path that is not there yet still has to compare against something, and the text of it is
  // the only honest answer: resolving is what the filesystem can add, not a requirement.
  it("gives back a path that does not exist rather than failing", () => {
    const missing = join(directory, "never-written.js");

    expect(resolvedPath(missing)).toBe(missing);
  });
});
