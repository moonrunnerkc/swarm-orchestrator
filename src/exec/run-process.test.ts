import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runProcessGroup } from "./run-process.ts";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "swarm-run-process-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function options(overrides: Record<string, unknown> = {}) {
  return {
    cwd: workspace,
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs: 10_000,
    maxOutputBytes: 1_000_000,
    ...overrides,
  };
}

async function writeSelfOutlivingTree() {
  await writeFile(
    join(workspace, "child.mjs"),
    "import { writeFileSync } from 'node:fs';\nsetTimeout(() => writeFileSync('orphan.txt', 'written'), 900);\n",
  );
  await writeFile(
    join(workspace, "parent.mjs"),
    "import { spawn } from 'node:child_process';\nspawn(process.execPath, ['child.mjs'], { stdio: 'ignore' });\nsetTimeout(() => {}, 20000);\n",
  );
}

describe("running a process the harness can still stop", () => {
  it("returns what an ordinary command wrote and the code it exited with", async () => {
    const ran = await runProcessGroup(
      process.execPath,
      ["-e", "process.stdout.write('out');process.stderr.write('err');process.exit(3)"],
      options(),
    );

    expect(ran.stdout).toBe("out");
    expect(ran.stderr).toBe("err");
    expect(ran.exitCode).toBe(3);
    expect(ran.timedOut).toBe(false);
  });

  it("kills the whole tree at the timeout, not only the process it started", async () => {
    await writeSelfOutlivingTree();

    const ran = await runProcessGroup(
      process.execPath,
      ["parent.mjs"],
      options({ timeoutMs: 300 }),
    );
    expect(ran.timedOut).toBe(true);

    await new Promise((settle) => setTimeout(settle, 2_500));
    expect(existsSync(join(workspace, "orphan.txt"))).toBe(false);
  }, 20_000);

  it("kills the whole tree when the run is cancelled", async () => {
    await writeSelfOutlivingTree();
    const cancel = new AbortController();
    setTimeout(() => cancel.abort(), 300);

    const ran = await runProcessGroup(
      process.execPath,
      ["parent.mjs"],
      options({ signal: cancel.signal }),
    );
    expect(ran.cancelled).toBe(true);

    await new Promise((settle) => setTimeout(settle, 2_500));
    expect(existsSync(join(workspace, "orphan.txt"))).toBe(false);
  }, 20_000);

  it("reports a program it could not start rather than an exit code it never got", async () => {
    const ran = await runProcessGroup("definitely-not-a-program-here", [], options());

    expect(ran.startFailure).toContain("ENOENT");
    expect(ran.exitCode).toBe(127);
  });

  it("stops reading at the output ceiling instead of holding everything in memory", async () => {
    const ran = await runProcessGroup(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(50000))"],
      options({ maxOutputBytes: 1_000 }),
    );

    expect(ran.stdout.length).toBeLessThanOrEqual(1_000);
    expect(ran.truncated).toBe(true);
  });

  it("gives the child only the environment it was handed", async () => {
    process.env.SWARM_TEST_LEAK_PROBE = "leaked";
    try {
      const ran = await runProcessGroup(
        process.execPath,
        ["-e", "process.stdout.write(process.env.SWARM_TEST_LEAK_PROBE ?? 'absent')"],
        options(),
      );

      expect(ran.stdout).toBe("absent");
    } finally {
      delete process.env.SWARM_TEST_LEAK_PROBE;
    }
  });
});
