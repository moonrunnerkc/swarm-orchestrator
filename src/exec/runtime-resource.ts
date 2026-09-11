import { z } from "zod";
import { readSessionEvidence } from "../durable/session-evidence.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { openEvidenceSession } from "../evidence/session.ts";

import {
  type ContainerBackendOptions,
  containerClientEnvironment,
  createContainerBackend,
} from "./container-backend.ts";
import { runProcessGroup } from "./run-process.ts";

const resourceSchema = z.object({
  runtime: z.enum(["docker", "podman", "nerdctl"]),
  identity: z.string().regex(/^swarm-[0-9a-f-]{36}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  phase: z.enum(["created", "removed", "cleanup-failed"]),
});
export function recordedContainerBackend(
  options: ContainerBackendOptions,
  evidence: EvidenceRecorder,
) {
  return createContainerBackend({
    ...options,
    sessionId: evidence.sessionId,
    observeLifecycle: async (event) => {
      await evidence.record({
        type: "execution-resource",
        actor: "harness",
        provenance: ["tool-output"],
        payload: resourceSchema.parse({
          ...event,
          runtime: options.runtime,
          sessionId: evidence.sessionId,
        }),
      });
    },
  });
}

/** Only a verified session identity with matching runtime labels can authorize removal. */
export async function repairRuntimeResources(
  root: string,
  runId: string,
  execute = runProcessGroup,
) {
  const { records, payloads } = await readSessionEvidence(root, runId);
  const resources = new Map<string, z.infer<typeof resourceSchema>>();
  for (const record of records.filter((entry) => entry.type === "execution-resource")) {
    const resource = resourceSchema.parse(payloads.get(record.payloadDigest));
    if (resource.sessionId !== runId)
      throw new Error("runtime resource belongs to another session");
    resources.set(resource.identity, resource);
  }
  const removed: string[] = [];
  const options = {
    cwd: root,
    env: containerClientEnvironment(),
    timeoutMs: 15_000,
    maxOutputBytes: 64_000,
  };
  for (const resource of resources.values()) {
    if (resource.phase === "removed") continue;
    const present = await execute(
      resource.runtime,
      ["ps", "--all", "--quiet", "--filter", `name=^/${resource.identity}$`],
      options,
    );
    if (present.exitCode !== 0)
      throw new Error(`cannot inspect ${resource.identity}; runtime repair is incomplete`);
    if (present.stdout.trim() === "") {
      removed.push(resource.identity);
      continue;
    }
    const labelled = await execute(
      resource.runtime,
      ["inspect", "--format", '{{index .Config.Labels "dev.swarm.session"}}', resource.identity],
      options,
    );
    if (labelled.exitCode !== 0 || labelled.stdout.trim() !== runId)
      throw new Error(`runtime label mismatch for ${resource.identity}; no resource was removed`);
    const stopped = await execute(resource.runtime, ["rm", "--force", resource.identity], options);
    const absent = await execute(
      resource.runtime,
      ["ps", "--all", "--quiet", "--filter", `name=^/${resource.identity}$`],
      options,
    );
    if (stopped.exitCode !== 0 || absent.exitCode !== 0 || absent.stdout.trim() !== "")
      throw new Error(
        `cleanup failed for ${resource.identity}; stop dispatch and repair the runtime`,
      );
    removed.push(resource.identity);
  }
  if (removed.length > 0) {
    const evidence = await openEvidenceSession({
      root,
      sessionId: runId,
      clock: { now: () => Date.now(), sleep: async () => {} },
    });
    for (const identity of removed) {
      const resource = resources.get(identity);
      if (resource === undefined) throw new Error("runtime repair lost its recorded identity");
      await evidence.record({
        type: "execution-resource",
        actor: "harness",
        provenance: ["tool-output"],
        payload: { ...resource, phase: "removed" },
      });
    }
  }
  return removed;
}
