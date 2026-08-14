import { z } from "zod";
import type { EvidenceRecorder } from "../evidence/session.ts";

/**
 * Invariant 12. "Unrelated to the task" is a semantic judgement and judging is a non-goal,
 * so the planner names its intended files first and the check is set membership. Widening
 * the set is allowed and cheap; doing it silently is not.
 */

interface FileSetAmendment {
  readonly added: readonly string[];
  readonly reason: string;
  /** The ledger record that carries the amendment, so a reviewer can go read it. */
  readonly record: string;
}

export interface FileSetState {
  readonly declared: readonly string[];
  readonly amendments: readonly FileSetAmendment[];
  readonly allowed: ReadonlySet<string>;
  /** False until the planner has declared anything at all. */
  readonly wasDeclared: boolean;
}

export const emptyFileSet: FileSetState = {
  declared: [],
  amendments: [],
  allowed: new Set(),
  wasDeclared: false,
};

const fileSetDeclarationSchema = z.object({
  files: z.array(z.string().min(1)).min(1),
  fileCount: z.number().int().positive(),
});

const fileSetAmendmentSchema = z.object({
  /** Empty when every named file was already in the set, which is recorded as it happened. */
  added: z.array(z.string().min(1)),
  addedCount: z.number().int().nonnegative(),
  reason: z.string().min(1),
  amendment: z.literal(true),
  fileCountAfter: z.number().int().nonnegative(),
});

export class FileSetAlreadyDeclaredError extends Error {
  constructor() {
    super(
      "a file set was already declared for this session. Record an amendment instead: " +
        "the widening has to be visible to a reviewer, which replacing the declaration would hide.",
    );
    this.name = "FileSetAlreadyDeclaredError";
  }
}

export interface FileSetRegistry {
  state(): FileSetState;
  declare(files: readonly string[], actor: string): Promise<FileSetState>;
  amend(files: readonly string[], reason: string, actor: string): Promise<FileSetState>;
}

/** Workspace-relative, slash-separated, no leading "./", so two spellings cannot both pass. */
export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
}

interface FileSetVerdict {
  readonly outside: readonly string[];
  readonly declaredCount: number;
  readonly changedCount: number;
  readonly wasDeclared: boolean;
}

export function checkFileSet(state: FileSetState, changedFiles: readonly string[]): FileSetVerdict {
  const changed = changedFiles.map(normalizePath);
  return {
    outside: changed.filter((path) => !state.allowed.has(path)).sort(),
    declaredCount: state.allowed.size,
    changedCount: changed.length,
    wasDeclared: state.wasDeclared,
  };
}

/**
 * Keeps the declared set in the ledger rather than in memory alone. The amendment also
 * submits a harness claim citing its own record, which is what puts the widening on the
 * review page instead of leaving it for someone to notice in a diff.
 */
export function createFileSetRegistry(evidence: EvidenceRecorder): FileSetRegistry {
  let current: FileSetState = emptyFileSet;

  return {
    state: () => current,

    async declare(files: readonly string[], actor: string): Promise<FileSetState> {
      if (current.wasDeclared) {
        throw new FileSetAlreadyDeclaredError();
      }
      const declared = unique(files);
      const payload = fileSetDeclarationSchema.parse({
        files: declared,
        fileCount: declared.length,
      });
      await evidence.record({
        type: "file-set-declared",
        actor,
        provenance: ["model"],
        payload,
      });
      current = {
        declared,
        amendments: [],
        allowed: new Set(declared),
        wasDeclared: true,
      };
      return current;
    },

    async amend(files: readonly string[], reason: string, actor: string): Promise<FileSetState> {
      const added = unique(files).filter((path) => !current.allowed.has(path));
      const allowed = new Set([...current.allowed, ...added]);
      const payload = fileSetAmendmentSchema.parse({
        added,
        addedCount: added.length,
        reason,
        amendment: true,
        fileCountAfter: allowed.size,
      });
      const recorded = await evidence.record({
        type: "file-set-amended",
        actor,
        provenance: ["model"],
        payload,
      });
      await evidence.submitClaim(
        {
          predicate: `amendment == true && addedCount == ${added.length} && fileCountAfter == ${allowed.size}`,
          record: recorded.record.payloadDigest,
          recordKind: "file-set-amended",
          narrative:
            added.length === 0
              ? `An amendment was recorded that widened nothing: every named file was already declared. Stated reason: ${reason}`
              : `The declared file set was widened to cover ${added.join(", ")}. Stated reason: ${reason}`,
        },
        actor,
      );
      current = {
        declared: current.declared,
        amendments: [
          ...current.amendments,
          { added, reason, record: recorded.record.payloadDigest },
        ],
        allowed,
        wasDeclared: current.wasDeclared,
      };
      return current;
    },
  };
}

function unique(files: readonly string[]): readonly string[] {
  return [...new Set(files.map(normalizePath).filter((path) => path.length > 0))].sort();
}
