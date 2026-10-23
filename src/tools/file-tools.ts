import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { readFileWindow } from "./bounded-file.ts";
import type { PolicyGuard } from "./policy-guard.ts";
import { defineTool, type ToolDefinition } from "./tool-definition.ts";
import { resolveInsideWorkspace } from "./workspace-path.ts";

const defaultReadLimit = 64_000;

const readInput = z.object({
  path: z.string().describe("Workspace-relative path to read."),
  maxBytes: z.number().int().positive().max(1_000_000).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

const writeInput = z.object({
  path: z.string().describe("Workspace-relative path to write."),
  content: z.string(),
});

const oneEdit = z.object({
  path: z.string().describe("Workspace-relative path to edit."),
  find: z.string().min(1).describe("Exact text to replace."),
  replace: z.string(),
  replaceAll: z.boolean().optional().describe("Replace every occurrence instead of requiring one."),
});

const maxBatchEdits = 50;

/**
 * One replacement, or a batch of them across files. A batch is checked whole before anything is
 * written and applied whole or not at all, so a mechanical change across twenty files is one call
 * that either lands or says which replacement it could not make. Held-out block 1's fastify rename
 * needed about forty separate edits and every Swarm arm ran out of wall making them one per turn.
 */
const editInput = z
  .object({
    path: z.string().optional().describe("Workspace-relative path to edit (single edit)."),
    find: z.string().min(1).optional().describe("Exact text to replace (single edit)."),
    replace: z.string().optional(),
    replaceAll: z
      .boolean()
      .optional()
      .describe("Replace every occurrence instead of requiring one."),
    edits: z
      .array(oneEdit)
      .min(1)
      .max(maxBatchEdits)
      .optional()
      .describe(
        "Instead of path/find/replace: several replacements, applied in order, all or none.",
      ),
    reason: z
      .string()
      .optional()
      .describe("Why the change replaces existing code rather than extending it, where asked."),
  })
  .refine((input) => (input.edits === undefined) !== (input.path === undefined), {
    message: "give either path, find and replace, or edits, not both",
  })
  .refine(
    (input) =>
      input.edits !== undefined || (input.find !== undefined && input.replace !== undefined),
    { message: "a single edit needs find and replace" },
  );

/** One change to one file as the edit tool is about to make it, for a review to read. */
export interface ProposedFileChange {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  /** The exact text replaced and its replacement, per replacement made. */
  readonly replacements: readonly { readonly find: string; readonly replace: string }[];
}

/**
 * A reading of edits beside the guard and the file set: it may refuse a change with a sentence
 * the model can act on, and it may add lines to the result once the change has landed. It never
 * edits anything itself.
 */
export interface EditReview {
  refuse(
    changes: readonly ProposedFileChange[],
    reason: string | undefined,
  ): Promise<string | null>;
  afterwards(changes: readonly ProposedFileChange[]): Promise<readonly string[]>;
}

const listInput = z.object({
  path: z.string().optional().describe("Workspace-relative directory. Defaults to the root."),
});

/**
 * Asked before a write or an edit touches a path: the sentence to refuse it with, or null.
 * Absent, nothing is refused, which is what a workspace with no declared file set is.
 */
export type WriteRefusal = (path: string) => string | null;

function refuseIfNotAuthorized(refuse: WriteRefusal | undefined, path: string): void {
  const refusal = refuse?.(path) ?? null;
  if (refusal !== null) {
    throw new Error(refusal);
  }
}

export function createReadTool(guard: PolicyGuard): ToolDefinition {
  return defineTool({
    name: "read",
    description: "Read a UTF-8 file from the workspace.",
    inputSchema: readInput,
    kind: "read",
    pathsFrom: (input) => [input.path],
    async execute(input, context) {
      if (input.endLine !== undefined && input.endLine < (input.startLine ?? 1))
        throw new Error("endLine must be at least startLine");
      const absolutePath = resolveInsideWorkspace(guard, input.path);
      const window = await readFileWindow(absolutePath, {
        ...input,
        maxBytes: input.maxBytes ?? defaultReadLimit,
        signal: context?.signal,
      });
      const { text, ...facts } = window;
      return {
        text: window.truncated
          ? `${text}\n[truncated after ${window.bytes} bytes; request a narrower line range]`
          : text,
        facts: { path: input.path, ...facts },
      };
    },
  });
}

export function createWriteTool(guard: PolicyGuard, refuse?: WriteRefusal): ToolDefinition {
  return defineTool({
    name: "write",
    description: "Create or overwrite a workspace file with UTF-8 content.",
    inputSchema: writeInput,
    kind: "write",
    pathsFrom: (input) => [input.path],
    async execute(input) {
      refuseIfNotAuthorized(refuse, input.path);
      const absolutePath = resolveInsideWorkspace(guard, input.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.content, "utf8");
      return {
        text: `wrote ${input.content.length} bytes to ${input.path}`,
        facts: { path: input.path, bytes: input.content.length },
      };
    },
  });
}

export function createEditTool(
  guard: PolicyGuard,
  refuse?: WriteRefusal,
  review?: EditReview,
): ToolDefinition {
  return defineTool({
    name: "edit",
    description:
      "Replace exact text in a workspace file. For a change repeated across files (a rename's references, an import path), pass edits: [{path, find, replace}, ...] to make every replacement in one call, all or none.",
    inputSchema: editInput,
    kind: "write",
    pathsFrom: (input) =>
      input.edits === undefined
        ? [input.path ?? ""]
        : [...new Set(input.edits.map((edit) => edit.path))],
    async execute(input) {
      const edits = input.edits ?? [
        {
          path: input.path ?? "",
          find: input.find ?? "",
          replace: input.replace ?? "",
          ...(input.replaceAll === undefined ? {} : { replaceAll: input.replaceAll }),
        },
      ];
      for (const path of new Set(edits.map((edit) => edit.path)))
        refuseIfNotAuthorized(refuse, path);
      // Every replacement is made in memory first, in order, so a later edit of the same file sees
      // the earlier one; nothing is written until all of them have been made.
      const contents = new Map<string, { before: string; after: string }>();
      const replacements = new Map<string, { find: string; replace: string }[]>();
      const counts: string[] = [];
      for (const [index, edit] of edits.entries()) {
        const absolutePath = resolveInsideWorkspace(guard, edit.path);
        const current = contents.get(absolutePath) ?? {
          before: await readFile(absolutePath, "utf8"),
          after: "",
        };
        const text = contents.has(absolutePath) ? current.after : current.before;
        const occurrences = text.split(edit.find).length - 1;
        const where = edits.length === 1 ? edit.path : `edit ${index + 1} (${edit.path})`;
        if (occurrences === 0)
          throw new Error(
            `no occurrence of the search text in ${where}. Read the file and copy the exact text.${edits.length > 1 ? " Nothing in the batch was applied." : ""}`,
          );
        if (occurrences > 1 && edit.replaceAll !== true)
          throw new Error(
            `the search text appears ${occurrences} times in ${where}. ` +
              `Extend it until it is unique, or pass replaceAll.${edits.length > 1 ? " Nothing in the batch was applied." : ""}`,
          );
        const after =
          edit.replaceAll === true
            ? text.split(edit.find).join(edit.replace)
            : text.replace(edit.find, () => edit.replace);
        contents.set(absolutePath, { before: current.before, after });
        replacements.set(absolutePath, [
          ...(replacements.get(absolutePath) ?? []),
          { find: edit.find, replace: edit.replace },
        ]);
        counts.push(`replaced ${occurrences} occurrence(s) in ${edit.path}`);
      }
      const changes: ProposedFileChange[] = [...contents].map(([absolutePath, content]) => ({
        path:
          edits.find((edit) => resolveInsideWorkspace(guard, edit.path) === absolutePath)?.path ??
          absolutePath,
        before: content.before,
        after: content.after,
        replacements: replacements.get(absolutePath) ?? [],
      }));
      const refusal = (await review?.refuse(changes, input.reason)) ?? null;
      if (refusal !== null) throw new Error(refusal);
      for (const [absolutePath, content] of contents)
        await writeFile(absolutePath, content.after, "utf8");
      const notes = (await review?.afterwards(changes)) ?? [];
      const first = edits[0];
      return {
        text: [...counts, ...notes].join("\n"),
        facts:
          edits.length === 1 && first !== undefined
            ? {
                path: first.path,
                occurrences: Number(/^replaced (\d+)/.exec(counts[0] ?? "")?.[1] ?? 0),
                bytes: changes[0]?.after.length ?? 0,
              }
            : { paths: changes.map((change) => change.path), edits: edits.length },
      };
    },
  });
}

/**
 * The directory a listing means. Absent and empty are the same request, the workspace root: a
 * model that sends `""` is saying "here" as plainly as one that sends nothing, and answering
 * that with "the path is empty" spends a step teaching it a distinction that means nothing.
 */
function directoryOf(path: string | undefined): string {
  return path === undefined || path.trim().length === 0 ? "." : path;
}

export function createListTool(guard: PolicyGuard): ToolDefinition {
  return defineTool({
    name: "list",
    description: "List the entries of a workspace directory.",
    inputSchema: listInput,
    kind: "read",
    pathsFrom: (input) => [directoryOf(input.path)],
    async execute(input) {
      const absolutePath = resolveInsideWorkspace(guard, directoryOf(input.path));
      const entries = await readdir(absolutePath, { withFileTypes: true });
      const names = entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
      return {
        text: names.length === 0 ? "(empty directory)" : names.join("\n"),
        facts: { path: directoryOf(input.path), entries: names.length },
      };
    },
  });
}
