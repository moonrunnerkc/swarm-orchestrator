import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { snapshotGoalCheckout } from "./goal-checkout.ts";

let root = "";
afterEach(async () => {
  if (root !== "") await rm(root, { recursive: true, force: true });
});

it("puts back what a check changed and leaves what it did not touch exactly as it was", async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-goal-checkout-"));
  const checkout = join(root, "checkout");
  const installed = join(checkout, "node_modules", "dep");
  await mkdir(installed, { recursive: true });
  await writeFile(join(installed, "LICENSE"), "kept\n", { mode: 0o644 });
  await writeFile(join(installed, "index.js"), "module.exports = 1;\n");
  await writeFile(join(checkout, "value.txt"), "original");
  await writeFile(join(checkout, "removed.txt"), "gone");
  await symlink("value.txt", join(checkout, "link"));
  const before = await lstat(join(installed, "LICENSE"));
  const snapshot = await snapshotGoalCheckout(checkout);
  try {
    await writeFile(join(checkout, "value.txt"), "changed");
    // Same size, different bytes: a size check alone would miss it.
    await writeFile(join(installed, "index.js"), "module.exports = 2;\n");
    await rm(join(checkout, "removed.txt"));
    await writeFile(join(checkout, "added.txt"), "new");
    await snapshot.restore();
  } finally {
    await snapshot.dispose();
  }
  const after = await lstat(join(installed, "LICENSE"));
  expect(after.ino).toBe(before.ino);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(after.mode).toBe(before.mode);
  expect(await readFile(join(checkout, "value.txt"), "utf8")).toBe("original");
  expect(await readFile(join(installed, "index.js"), "utf8")).toBe("module.exports = 1;\n");
  expect(await readFile(join(checkout, "removed.txt"), "utf8")).toBe("gone");
  expect((await lstat(join(checkout, "link"))).isSymbolicLink()).toBe(true);
  await expect(lstat(join(checkout, "added.txt"))).rejects.toMatchObject({ code: "ENOENT" });
});
