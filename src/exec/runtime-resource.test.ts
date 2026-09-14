import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openEvidenceSession } from "../evidence/session.ts";
import { repairRuntimeResources } from "./runtime-resource.ts";

it("refuses to remove a runtime resource whose session label does not match", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-runtime-repair-"));
  try {
    const evidence = await openEvidenceSession({
      root,
      sessionId: "one",
      clock: { now: () => 0, sleep: async () => {} },
    });
    await evidence.record({
      type: "execution-resource",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        runtime: "docker",
        identity: "swarm-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        sessionId: "one",
        phase: "created",
      },
    });
    const commands: string[] = [];
    await expect(
      repairRuntimeResources(root, "one", async (_program, argv) => {
        commands.push(argv[0] ?? "");
        return {
          stdout: argv[0] === "ps" ? "present" : "another-session",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          truncated: false,
          startFailure: null,
        };
      }),
    ).rejects.toThrow(/label mismatch/);
    expect(commands).toEqual(["ps", "inspect"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reconciles creation intent with a matching session label using the existing recorder", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-intent-"));
  try {
    const evidence = await openEvidenceSession({
      root,
      sessionId: "one",
      clock: { now: () => 0, sleep: async () => {} },
    });
    await evidence.record({
      type: "execution-resource",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        runtime: "docker",
        identity: "swarm-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        sessionId: "one",
        phase: "create-intent",
      },
    });
    let removed = false;
    const commands: string[] = [];
    await repairRuntimeResources(
      root,
      "one",
      async (_program, argv) => {
        commands.push(argv[0] ?? "");
        if (argv[0] === "rm") removed = true;
        return {
          stdout: argv[0] === "inspect" ? "one" : argv[0] === "ps" && !removed ? "present" : "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          truncated: false,
          startFailure: null,
        };
      },
      evidence,
    );
    expect(commands).toEqual(["ps", "inspect", "rm", "ps"]);
    expect(evidence.records()).toHaveLength(2);
    const captured = evidence.records().at(-1);
    expect(evidence.payloads().get(captured?.payloadDigest ?? "")).toMatchObject({
      phase: "removed",
    });
    await evidence.record({
      type: "session-stopped",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { reason: "cleanup completed" },
    });
    expect(evidence.records()).toHaveLength(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
