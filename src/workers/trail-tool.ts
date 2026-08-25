import { z } from "zod";
import { defineTool, type ToolDefinition } from "../tools/tool-definition.ts";
import { projectTrail, renderTrail, type TrailPeer } from "./trail.ts";

/**
 * The peers as they stand when the tool is called rather than when it was registered:
 * workers run concurrently, so a trail read early in a run sees less than one read late,
 * and that difference is the coordination.
 */
export interface TrailSource {
  peers(): readonly TrailPeer[];
}

const readTrailInput = z.object({});

/**
 * Stigmergy as a tool, so it travels the one execution path invariant 3 allows. The
 * chokepoint records the call and tags what comes back as tool output, which is what puts
 * a peer's words under the derivation heuristic rather than beside it.
 */
export function createReadTrailTool(source: TrailSource): ToolDefinition {
  return defineTool({
    name: "read_trail",
    description:
      "Read what the other workers in this run have already declared, failed, and spent " +
      "their attempts on. Advice from their ledgers, never a result about your own work.",
    inputSchema: readTrailInput,
    kind: "evidence",
    pathsFrom: () => [],
    execute() {
      const trail = projectTrail(source.peers());
      return Promise.resolve({
        text: renderTrail(trail),
        facts: { sourceCount: trail.sourceCount, signalCount: trail.signals.length },
      });
    },
  });
}
