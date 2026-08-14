import { z } from "zod";
import type { JsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

/**
 * Invariant 12. "Unrelated to the task" is a semantic judgement and judging is a non-goal,
 * so the planner names its intended files first and the check is set membership. Widening
 * the set is allowed and cheap; doing it silently is not.
 *
 * "First" is load-bearing and is checked against ledger order, not just against the set as it
 * stands at the end. A declaration written after the edit it names is a declaration that
 * describes what was done rather than what was intended, and it reaches the same verdict as
 * an out-of-set edit: it needs a recorded amendment a reviewer sees.
 */

interface FileSetAmendment {
  /** Every file the amendment names, including ones the set already allowed. */
  readonly files: readonly string[];
  /** Of those, the ones the set did not already allow. */
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
  /**
   * Paths a recorded write reached before any declaration or amendment named them, read off
   * the ledger's own ordering. Empty on the ordinary path, where the declaration comes first.
   */
  readonly editedBeforeAuthorized: readonly string[];
}

export const emptyFileSet: FileSetState = {
  declared: [],
  amendments: [],
  allowed: new Set(),
  wasDeclared: false,
  editedBeforeAuthorized: [],
};

const fileSetDeclarationSchema = z.object({
  files: z.array(z.string().min(1)).min(1),
  fileCount: z.number().int().positive(),
});

const fileSetAmendmentSchema = z.object({
  /**
   * What the amendment is about, which is not the same as what it widened. A file declared
   * only after it was edited is already in the set, so `added` is empty and this is the only
   * field that says which file the reviewer is being asked to look at.
   */
  files: z.array(z.string().min(1)).min(1),
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
  /** Of the changed files, the ones whose edit the ledger records before its authorization. */
  readonly editedBeforeAuthorized: readonly string[];
  readonly declaredCount: number;
  readonly changedCount: number;
  readonly wasDeclared: boolean;
}

export function checkFileSet(state: FileSetState, changedFiles: readonly string[]): FileSetVerdict {
  const changed = changedFiles.map(normalizePath);
  const touched = new Set(changed);
  return {
    outside: changed.filter((path) => !state.allowed.has(path)).sort(),
    editedBeforeAuthorized: state.editedBeforeAuthorized.filter((path) => touched.has(path)),
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

  /**
   * Recomputed from the chain rather than tracked alongside it. The ledger is the record of
   * what happened in what order, so reading the answer off anything else would be trusting a
   * second account of the same events.
   */
  const withLedgerOrder = (state: FileSetState): FileSetState => ({
    ...state,
    editedBeforeAuthorized: writesBeforeAuthorization(evidence, state),
  });

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
      current = withLedgerOrder({
        declared,
        amendments: [],
        allowed: new Set(declared),
        wasDeclared: true,
        editedBeforeAuthorized: [],
      });
      return current;
    },

    async amend(files: readonly string[], reason: string, actor: string): Promise<FileSetState> {
      const named = unique(files);
      const added = named.filter((path) => !current.allowed.has(path));
      const allowed = new Set([...current.allowed, ...added]);
      const payload = fileSetAmendmentSchema.parse({
        files: named,
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
              ? `An amendment was recorded for ${named.join(", ")}, which the set already allowed. Stated reason: ${reason}`
              : `The declared file set was widened to cover ${added.join(", ")}. Stated reason: ${reason}`,
        },
        actor,
      );
      current = withLedgerOrder({
        declared: current.declared,
        amendments: [
          ...current.amendments,
          { files: named, added, reason, record: recorded.record.payloadDigest },
        ],
        allowed,
        wasDeclared: current.wasDeclared,
        editedBeforeAuthorized: [],
      });
      return current;
    },
  };
}

function unique(files: readonly string[]): readonly string[] {
  return [...new Set(files.map(normalizePath).filter((path) => path.length > 0))].sort();
}

/**
 * Walks the chain once. A path is authorized from the record that first names it, so a write
 * recorded earlier than that was never authorized by anything, whatever the set looks like by
 * the end. An amendment naming the path settles it either way: an amendment is the reviewer-
 * visible admission that the set moved, which is the whole remedy invariant 12 asks for.
 */
function writesBeforeAuthorization(
  evidence: EvidenceRecorder,
  state: FileSetState,
): readonly string[] {
  const amended = new Set(state.amendments.flatMap((amendment) => amendment.files));
  const payloads = evidence.payloads();
  const authorized = new Set<string>();
  const unauthorized = new Set<string>();

  for (const record of evidence.records()) {
    const payload = payloads.get(record.payloadDigest);
    if (payload === undefined || payload === null || typeof payload !== "object") {
      continue;
    }
    const fields = payload as { readonly [key: string]: JsonValue };

    if (record.type === "file-set-declared" || record.type === "file-set-amended") {
      for (const file of namedFiles(fields)) {
        authorized.add(file);
      }
      continue;
    }
    if (record.type !== "tool-call" || fields.kind !== "write" || fields.decision !== "allowed") {
      continue;
    }
    const path = writtenPath(fields);
    if (path !== null && !authorized.has(path) && !amended.has(path)) {
      unauthorized.add(path);
    }
  }

  return [...unauthorized].sort();
}

/** Both record types name their files in the same field, so one reader serves both. */
function namedFiles(fields: { readonly [key: string]: JsonValue }): readonly string[] {
  const named = fields.files;
  if (!Array.isArray(named)) {
    return [];
  }
  return named.filter((file): file is string => typeof file === "string").map(normalizePath);
}

function writtenPath(fields: { readonly [key: string]: JsonValue }): string | null {
  const facts = fields.facts;
  if (facts === null || typeof facts !== "object" || Array.isArray(facts)) {
    return null;
  }
  const path = (facts as { readonly [key: string]: JsonValue }).path;
  return typeof path === "string" ? normalizePath(path) : null;
}
