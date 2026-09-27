import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { containerRuntimeAvailable, createContainerBackend } from "../exec/container-backend.ts";
import { snapshotGoalCheckout } from "./goal-checkout.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

it.skipIf(!containerRuntimeAvailable("docker"))(
  "keeps Git readable inside the container after restoring a check snapshot",
  async () => {
    const workspace = await mkdtemp(join(homedir(), ".swarm-checkout-test-"));
    const host = createNodeCommandRunner(createSystemClock(), harnessChildEnvironment());
    const run = (argv: string[]) => host.runVouched(argv, { cwd: workspace, timeoutMs: 10000 });
    try {
      await writeFile(join(workspace, "value.txt"), "original");
      for (const argv of [
        ["git", "init", "-q"],
        ["git", "add", "value.txt"],
        [
          "git",
          "-c",
          "user.name=fixture",
          "-c",
          "user.email=fixture@example.test",
          "commit",
          "-qm",
          "base",
        ],
      ])
        expect((await run(argv)).exitCode).toBe(0);
      const head = (await run(["git", "rev-parse", "HEAD"])).stdout.trim();
      const backend = createContainerBackend({
        runtime: "docker",
        image: "node:24-bookworm",
        workspaceRoot: workspace,
        user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      });
      const options = { cwd: workspace, timeoutMs: 30000 };
      expect((await backend.run(["git", "checkout", "--detach", head], options)).exitCode).toBe(0);
      const snapshot = await snapshotGoalCheckout(workspace);
      try {
        expect((await backend.run(["git", "diff", "--exit-code", head], options)).exitCode).toBe(0);
        await snapshot.restore();
        const restored = await backend.run(["git", "rev-parse", "HEAD"], options);
        expect(restored.exitCode, restored.stderr).toBe(0);
        expect(restored.stdout.trim()).toBe(head);
      } finally {
        await snapshot.dispose();
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
  45000,
);
