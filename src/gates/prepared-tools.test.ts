import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { withPreparedTools } from "./prepared-tools.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-prepared-tools-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("finds a tool the install prepared through the built PATH, and only through that runner", async () => {
  const bin = join(root, "node_modules", ".swarm-pnpm", "node_modules", ".bin");
  await mkdir(bin, { recursive: true });
  const tool = join(bin, "swarm-prepared-tool-probe");
  await writeFile(tool, "#!/bin/sh\necho prepared tool ran\n");
  await chmod(tool, 0o755);
  const plain = createNodeCommandRunner(createSystemClock(), harnessChildEnvironment());
  const options = { cwd: root, timeoutMs: 30_000 };

  const without = await plain.run("swarm-prepared-tool-probe", options);
  expect(without.exitCode).not.toBe(0);

  const prepared = withPreparedTools(plain, [bin]);
  const declared = await prepared.run("swarm-prepared-tool-probe", options);
  expect(declared.stdout).toBe("prepared tool ran\n");
  const vouched = await prepared.runVouched(["swarm-prepared-tool-probe"], options);
  expect(vouched.stdout).toBe("prepared tool ran\n");
  expect(withPreparedTools(plain, [])).toBe(plain);
});

it("refuses to run with a tool directory that cannot be one PATH entry", async () => {
  const runner = withPreparedTools(
    createNodeCommandRunner(createSystemClock(), harnessChildEnvironment()),
    ["relative/bin"],
  );
  const observed = await runner.run("true", { cwd: root, timeoutMs: 30_000 });
  expect(observed.unavailable).toContain("cannot be put on PATH");
});
