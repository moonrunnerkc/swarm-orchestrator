import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { digestOfBytes, digestOfJson } from "../evidence/canonical-json.ts";

const driverSchema = z.object({
  id: z.string().min(1),
  module: z.string().min(1),
  sourceDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  args: z.array(z.string()).default([]),
});
/** A comparison arm is an actual driver, never just a different filename for the same invocation. */
export async function readArmDriver(path: string, expectedId: string) {
  const driver = driverSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (driver.id !== expectedId) throw new Error("arm configuration identity does not match --arm");
  const module = resolve(path, "..", driver.module);
  const source = await readFile(module, "utf8");
  if (digestOfBytes(source) !== driver.sourceDigest)
    throw new Error(`arm ${expectedId} implementation digest mismatch`);
  return {
    ...driver,
    module,
    implementationDigest: digestOfJson({ sourceDigest: driver.sourceDigest, args: driver.args }),
    argv: (inputPath: string) => [
      process.execPath,
      module,
      ...driver.args,
      "--swarm-task-input",
      inputPath,
    ],
  };
}
