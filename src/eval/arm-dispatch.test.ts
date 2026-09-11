import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { readArmDriver } from "./arm-dispatch.ts";

it("selects a digest-bound driver and refuses a changed implementation", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-driver-"));
  try {
    const source = "process.stdout.write('baseline');\n";
    await writeFile(join(root, "driver.mjs"), source);
    const config = join(root, "arm.json");
    await writeFile(
      config,
      JSON.stringify({
        id: "baseline",
        module: "driver.mjs",
        sourceDigest: digestOfBytes(source),
        args: [],
      }),
    );
    const driver = await readArmDriver(config, "baseline");
    expect(driver.argv("/harness/task.json")).toEqual([
      process.execPath,
      join(root, "driver.mjs"),
      "--swarm-task-input",
      "/harness/task.json",
    ]);
    await writeFile(join(root, "driver.mjs"), "throw new Error('changed');");
    await expect(readArmDriver(config, "baseline")).rejects.toThrow(/digest mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
