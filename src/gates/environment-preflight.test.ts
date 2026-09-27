import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { preflightEnvironment } from "./environment-preflight.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

it("observes actual versions without running a project script and refuses absent runners", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-environment-preflight-"));
  const clock = createSystemClock();
  const evidence = await openEvidenceSession({ root, sessionId: "evidence", clock });
  const commands = createNodeCommandRunner(clock, harnessChildEnvironment());
  const notes: string[] = [];
  const check = () =>
    preflightEnvironment({
      workspace: root,
      gates: [],
      commands,
      evidence,
      note: (text) => notes.push(text),
      timeoutMs: 15000,
    });
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node --test", pretest: "exit 99" } }),
    );
    await expect(check()).resolves.toBeUndefined();
    expect(notes.some((line) => line.startsWith(".: Node v"))).toBe(true);
    expect(notes.some((line) => line.startsWith(".: npm "))).toBe(true);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    await expect(check()).rejects.toThrow("Vitest setup unavailable");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ packageManager: "npm@0.0.0", scripts: { test: "node --test" } }),
    );
    await expect(check()).rejects.toThrow("declared version 0.0.0");
    expect(
      evidence.records().filter((record) => record.type === "verification-command").length,
    ).toBeGreaterThan(6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
