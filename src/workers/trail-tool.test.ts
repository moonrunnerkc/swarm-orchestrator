import { describe, expect, it } from "vitest";
import { digestOfJson, type JsonValue } from "../evidence/canonical-json.ts";
import type { LedgerRecord } from "../evidence/ledger-record.ts";
import type { TrailPeer } from "./trail.ts";
import { createReadTrailTool } from "./trail-tool.ts";

function peerClaiming(workerId: string, path: string): TrailPeer {
  const payload: JsonValue = { files: [path], fileCount: 1 };
  const payloadDigest = digestOfJson(payload);
  const record: LedgerRecord = {
    schemaVersion: 1,
    sequence: 0,
    previousHash: "genesis",
    timestamp: 0,
    type: "file-set-declared",
    actor: "harness",
    payloadDigest,
    provenance: ["model"],
  };
  return {
    workerId,
    chain: {
      sessionId: `run-${workerId}`,
      records: () => [record],
      payloads: () => new Map([[payloadDigest, payload]]),
    },
  };
}

describe("the read_trail tool", () => {
  it("is an evidence tool that reaches no workspace path", () => {
    const tool = createReadTrailTool({ peers: () => [] });

    expect(tool.name).toBe("read_trail");
    expect(tool.kind).toBe("evidence");
    expect(tool.pathsFrom({})).toEqual([]);
  });

  it("shows the model what its peers have claimed", async () => {
    const tool = createReadTrailTool({ peers: () => [peerClaiming("worker-2", "src/alpha.ts")] });

    const output = await tool.execute({});

    expect(output.text).toContain("worker-2 declared src/alpha.ts");
  });

  it("records how many chains it read and how many signals came back", async () => {
    const tool = createReadTrailTool({
      peers: () => [peerClaiming("worker-2", "src/alpha.ts"), peerClaiming("worker-3", "src/b.ts")],
    });

    const output = await tool.execute({});

    expect(output.facts).toEqual({ sourceCount: 2, signalCount: 2 });
  });

  it("reads the peers as they stand at call time, not as they stood at registration", async () => {
    const peers: TrailPeer[] = [];
    const tool = createReadTrailTool({ peers: () => peers });

    const before = await tool.execute({});
    peers.push(peerClaiming("worker-2", "src/alpha.ts"));
    const after = await tool.execute({});

    expect(before.facts).toMatchObject({ signalCount: 0 });
    expect(after.facts).toMatchObject({ signalCount: 1 });
  });
});
