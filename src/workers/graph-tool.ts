import { z } from "zod";
import { defineTool, type ToolDefinition } from "../tools/tool-definition.ts";
import { InvalidTaskGraphError, readTaskGraph, type TaskGraph } from "./task-graph.ts";

/**
 * Loose on the way in and strict on the way through. The schema here only has to be enough
 * for the chokepoint to accept the call, because `readTaskGraph` is the one place a graph is
 * judged, and a refusal has to reach the model as text it can act on rather than as a
 * validation error that ends the call.
 */
const declareInput = z.object({
  goal: z.string().describe("The goal these nodes are meant to satisfy, in one sentence."),
  nodes: z
    .array(
      z.object({
        id: z.string().describe("Lower-case letters, digits and hyphens. Unique in the graph."),
        title: z.string().describe("A few words a person reads in a report."),
        instruction: z.string().describe("The task a worker is handed. Write it as a brief."),
        files: z
          .array(z.string())
          .describe("Workspace-relative files this node intends to create or edit."),
        dependsOn: z
          .array(z.string())
          .optional()
          .describe("Ids of nodes that must land before this one starts."),
        acceptance: z
          .array(z.string())
          .optional()
          .describe("Gate ids that must be green. Omit for every blocking gate."),
      }),
    )
    .describe("The nodes, in any order. Dependencies decide what runs when, not this order."),
});

/** Where the planner puts what it declared, so the run can read it after the loop ends. */
export interface DeclaredGraph {
  graph: TaskGraph | null;
}

export function createDeclareTaskGraphTool(declared: DeclaredGraph): ToolDefinition {
  return defineTool({
    name: "declare_task_graph",
    description:
      "Declare the goal broken into tasks, with the files each one intends to touch and what " +
      "must land before it. Ids are lower-case slugs. Two tasks that could run at once must " +
      "not name the same file, or they will be run one after the other.",
    inputSchema: declareInput,
    kind: "evidence",
    pathsFrom: () => [],
    execute(input) {
      try {
        const graph = readTaskGraph(input);
        declared.graph = graph;
        return Promise.resolve({
          text:
            `declared ${graph.nodes.length} node(s): ` +
            graph.nodes.map((node) => node.id).join(", "),
          facts: { nodeCount: graph.nodes.length },
        });
      } catch (cause) {
        if (cause instanceof InvalidTaskGraphError) {
          // Back to the model as prose, not as a thrown call: a graph it can fix is worth
          // another turn, and a run that dies on the first bad id has spent a planner for
          // nothing.
          return Promise.resolve({
            text: `that graph was not accepted: ${cause.message}. Call the tool again, fixed.`,
            facts: { nodeCount: 0 },
          });
        }
        throw cause;
      }
    },
  });
}
