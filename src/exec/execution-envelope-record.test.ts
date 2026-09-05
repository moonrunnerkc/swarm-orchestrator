import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openEvidenceSession } from "../evidence/session.ts";
import { recordExecutionEnvelope } from "./execution-envelope-record.ts";
import {
  describeExecutionEnvelope,
  hostExecutionBackend,
  selfTestContainment,
} from "./execution-mode.ts";

let root = "";
let workspace = "";
let hostSecret = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-envelope-record-"));
  workspace = join(root, "workspace");
  await mkdtemp(join(tmpdir(), "swarm-envelope-ws-")).then(async (made) => {
    workspace = made;
  });
  hostSecret = join(root, "host-secret.txt");
  await writeFile(hostSecret, "a value only the host should hold\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe("the envelope a run executed under, as evidence", () => {
  it("lands on the chain, so the mode is a record rather than something the CLI said", async () => {
    const evidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: "envelope",
      clock: { now: () => 0, sleep: () => Promise.resolve() },
    });

    const envelope = describeExecutionEnvelope({
      selfTest: await selfTestContainment(hostExecutionBackend, {
        workspaceRoot: workspace,
        hostFileOutsideWorkspace: hostSecret,
      }),
      workspaceRoot: workspace,
      withheldEnvironmentNames: ["ANTHROPIC_API_KEY"],
      repositoryConfigTrusted: false,
    });

    await recordExecutionEnvelope(evidence, envelope);

    const record = evidence.records().find((entry) => entry.type === "execution-envelope");
    expect(record).toBeDefined();
    expect(record?.actor).toBe("harness");

    const payload = JSON.parse((await evidence.blobs.bytes(record?.payloadDigest ?? "")) ?? "{}");
    expect(payload.mode).toBe("restricted");
    expect(payload.backend).toBe("host");
    // The escapes travel with it: a verdict nobody can check is the thing this replaces.
    expect(payload.probes).toHaveLength(3);
  }, 30_000);
});
