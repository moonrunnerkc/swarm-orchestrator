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
