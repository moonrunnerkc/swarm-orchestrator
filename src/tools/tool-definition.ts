import type { ZodType } from "zod";
import type { ToolSchema } from "../core/model-client.ts";

/**
 * What the chokepoint must enforce before a tool runs. Adding a tool means adding a
 * definition with one of these kinds, never a new execution path (invariant 3).
 */
export type ToolKind = "read" | "write" | "shell";

/** A tool as the chokepoint sees it: input already erased to unknown. */
export interface ToolDefinition extends ToolSchema {
  readonly kind: ToolKind;
  /** Workspace paths this call would touch, so the sandbox can rule before anything runs. */
  readonly pathsFrom: (input: unknown) => readonly string[];
  execute(input: unknown): Promise<string>;
}

/** A tool as its author writes it, with the input type its schema describes. */
export interface TypedToolSpec<Input> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<Input>;
  readonly kind: ToolKind;
  readonly pathsFrom: (input: Input) => readonly string[];
  execute(input: Input): Promise<string>;
}

/**
 * Erases the input type at the registry boundary. Re-parsing here costs little and
 * makes a bypassed chokepoint fail loudly instead of running on unvalidated input.
 */
export function defineTool<Input>(spec: TypedToolSpec<Input>): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    kind: spec.kind,
    pathsFrom: (input) => spec.pathsFrom(spec.inputSchema.parse(input)),
    execute: (input) => spec.execute(spec.inputSchema.parse(input)),
  };
}
