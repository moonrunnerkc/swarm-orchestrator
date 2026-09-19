import { z } from "zod";
import { asJsonValue, type JsonValue } from "../evidence/canonical-json.ts";
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

/** A path once recorded as temporary that the agent then chose to keep, with the reason it gave. */
interface RetainedTemporary {
  readonly path: string;
  readonly reason: string;
  readonly record: string;
}

export interface FileSetState {
  /**
   * Paths the agent recorded as created only to investigate: a probe script, a scratch check.
   * Two repairs in the reach-pressure run left such a file in the final patch, and nothing in
   * either record said it was not meant to be there. What makes a file temporary is the agent
   * having said so on the ledger, never what it is called: `tmp` in a name decides nothing, and
   * plenty of repositories ship a file with it.
   */
  readonly temporary?: ReadonlySet<string>;
  /** Temporary paths deliberately kept by a recorded amendment. No longer in `temporary`. */
  readonly retained?: readonly RetainedTemporary[];
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
  temporary: new Set(),
  retained: [],
  declared: [],
  amendments: [],
  allowed: new Set(),
  wasDeclared: false,
  editedBeforeAuthorized: [],
};

const fileSetDeclarationSchema = z.object({
  files: z.array(z.string().min(1)).min(1),
  fileCount: z.number().int().positive(),
  /** Of `files`, the ones that must be gone by the end. Absent on every earlier ledger. */
  temporary: z.array(z.string().min(1)).optional(),
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
  /** Of `files`, the ones this amendment records as temporary. */
  temporary: z.array(z.string().min(1)).optional(),
  /** Temporary paths this amendment keeps on purpose. The amendment's reason is the reason. */
  retain: z.array(z.string().min(1)).optional(),
});

export class NothingTemporaryToRetainError extends Error {
  constructor(paths: readonly string[]) {
    super(
      `${paths.join(", ")} was never recorded as temporary, so there is nothing to retain. ` +
        "A file that belongs in the change needs only to be in the declared set.",
    );
    this.name = "NothingTemporaryToRetainError";
  }
}

export class FileSetAlreadyDeclaredError extends Error {
  constructor() {
    super(
      "a file set was already declared for this session. Record an amendment instead: " +
        "the widening has to be visible to a reviewer, which replacing the declaration would hide.",
    );
    this.name = "FileSetAlreadyDeclaredError";
  }
}

export interface FileSetMarks {
  /** Paths created only to investigate. Authorized like any other, and owed a removal. */
  readonly temporary?: readonly string[];
  /** Amendment only: temporary paths to keep after all, for the amendment's stated reason. */
  readonly retain?: readonly string[];
}

export interface FileSetRegistry {
  state(): FileSetState;
  declare(files: readonly string[], actor: string, marks?: FileSetMarks): Promise<FileSetState>;
  amend(
    files: readonly string[],
    reason: string,
    actor: string,
    marks?: FileSetMarks,
  ): Promise<FileSetState>;
}

/** Workspace-relative, slash-separated, no leading "./", so two spellings cannot both pass. */
export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
}

/**
 * Why a write to this path is refused before it happens, or null where it may go ahead. The
 * gate still checks every changed file against the ledger's order afterwards (invariant 12);
 * this is the same rule asked at the tool, so the model hears it before the edit rather than
 * after the loop. An edit the chain records before any declaration names its file can never
 * be cleared by a later declaration, only by an amendment, and a run that fixed the defect in
 * its first turn was escalated for exactly that, twice over, in the campaign.
 */
export function writeRefusal(state: FileSetState, path: string): string | null {
  const normalized = normalizePath(path);
  if (!state.wasDeclared) {
    return (
      `no file set is declared yet, so ${normalized} cannot be written. Call declare_file_set ` +
      `first with every file you intend to touch, ${normalized} among them; an edit recorded ` +
      "before its declaration fails the file-set gate and no later declaration clears it."
    );
  }
  if (state.allowed.has(normalized)) {
    return null;
  }
  return (
    `${normalized} is outside the declared file set (${[...state.allowed].sort().join(", ")}). ` +
    `Call amend_file_set with a reason a reviewer will read, naming ${normalized}, before ` +
    "writing it."
  );
}

interface FileSetVerdict {
  /** Recorded as temporary and still in the change. */
  readonly temporaryStillPresent: readonly string[];
  /** Once temporary, kept by amendment, and in the change: named so the evidence says so. */
  readonly retainedInChange: readonly RetainedTemporary[];
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
    temporaryStillPresent: changed.filter((path) => state.temporary?.has(path) === true).sort(),
    retainedInChange: (state.retained ?? []).filter((kept) => touched.has(kept.path)),
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
/**
 * The file set a ledger holds, read off its records. The registry starts from this, and a reader
 * of a finished session uses it alone: what a run declared, marked temporary and retained is a
 * fact about its ledger and needs no live session to ask.
 */
export function replayFileSet(
  evidence: Pick<EvidenceRecorder, "records" | "payloads">,
): FileSetState {
  let current: FileSetState = emptyFileSet;
  for (const record of evidence.records()) {
    if (record.type === "file-set-declared") {
      if (current.wasDeclared) throw new FileSetAlreadyDeclaredError();
      const declaration = fileSetDeclarationSchema.parse(
        evidence.payloads().get(record.payloadDigest),
      );
      const declared = unique(declaration.files);
      if (declared.length !== declaration.fileCount)
        throw new Error("file-set declaration count does not match its files");
      current = {
        ...emptyFileSet,
        declared,
        allowed: new Set(declared),
        wasDeclared: true,
        temporary: new Set(unique(declaration.temporary ?? [])),
      };
    }
    if (record.type === "file-set-amended") {
      const amendment = fileSetAmendmentSchema.parse(evidence.payloads().get(record.payloadDigest));
      const added = amendment.files.filter((path) => !current.allowed.has(path));
      const allowed = new Set([...current.allowed, ...amendment.files]);
      if (
        added.length !== amendment.addedCount ||
        allowed.size !== amendment.fileCountAfter ||
        added.some((path) => !amendment.added.includes(path))
      )
        throw new Error("file-set amendment does not follow from its prior authorization");
      current = {
        ...current,
        allowed,
        ...marked(current, amendment, record.payloadDigest),
        amendments: [
          ...current.amendments,
          { files: amendment.files, added, reason: amendment.reason, record: record.payloadDigest },
        ],
      };
    }
  }
  return { ...current, editedBeforeAuthorized: writesBeforeAuthorization(evidence, current) };
}

export function createFileSetRegistry(evidence: EvidenceRecorder): FileSetRegistry {
  let current: FileSetState = replayFileSet(evidence);

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

    async declare(
      files: readonly string[],
      actor: string,
      marks: FileSetMarks = {},
    ): Promise<FileSetState> {
      if (current.wasDeclared) {
        throw new FileSetAlreadyDeclaredError();
      }
      const temporary = unique(marks.temporary ?? []);
      // Naming a path temporary authorizes it: it is about to be written like any other.
      const declared = unique([...files, ...temporary]);
      const payload = fileSetDeclarationSchema.parse({
        files: declared,
        fileCount: declared.length,
        ...(temporary.length === 0 ? {} : { temporary }),
      });
      await evidence.record({
        type: "file-set-declared",
        actor,
        provenance: ["model"],
        payload: asJsonValue(payload),
      });
      current = withLedgerOrder({
        temporary: new Set(temporary),
        retained: [],
        declared,
        amendments: [],
        allowed: new Set(declared),
        wasDeclared: true,
        editedBeforeAuthorized: [],
      });
      return current;
    },

    async amend(
      files: readonly string[],
      reason: string,
      actor: string,
      marks: FileSetMarks = {},
    ): Promise<FileSetState> {
      const temporary = unique(marks.temporary ?? []);
      const retain = unique(marks.retain ?? []);
      const neverTemporary = retain.filter((path) => current.temporary?.has(path) !== true);
      if (neverTemporary.length > 0) throw new NothingTemporaryToRetainError(neverTemporary);
      const named = unique([...files, ...temporary, ...retain]);
      const added = named.filter((path) => !current.allowed.has(path));
      const allowed = new Set([...current.allowed, ...added]);
      const payload = fileSetAmendmentSchema.parse({
        files: named,
        added,
        addedCount: added.length,
        reason,
        amendment: true,
        fileCountAfter: allowed.size,
        ...(temporary.length === 0 ? {} : { temporary }),
        ...(retain.length === 0 ? {} : { retain }),
      });
      const recorded = await evidence.record({
        type: "file-set-amended",
        actor,
        provenance: ["model"],
        payload: asJsonValue(payload),
      });
      await evidence.submitClaim(
        {
          predicate: `amendment == true && addedCount == ${added.length} && fileCountAfter == ${allowed.size}`,
          record: recorded.record.payloadDigest,
          recordKind: "file-set-amended",
          narrative:
            (added.length === 0
              ? `An amendment was recorded for ${named.join(", ")}, which the set already allowed. Stated reason: ${reason}`
              : `The declared file set was widened to cover ${added.join(", ")}. Stated reason: ${reason}`) +
            (retain.length === 0
              ? ""
              : ` It keeps ${retain.join(", ")}, recorded earlier as temporary, in the change.`),
        },
        actor,
      );
      current = withLedgerOrder({
        ...marked(current, payload, recorded.record.payloadDigest),
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

/**
 * The temporary and retained sets after one amendment, by the one rule replay and a live
 * amendment share. Retaining wins over marking where an amendment names a path under both: the
 * agent has said, in the same breath, that it is keeping it.
 */
function marked(
  state: FileSetState,
  amendment: {
    readonly temporary?: readonly string[] | undefined;
    readonly retain?: readonly string[] | undefined;
    readonly reason: string;
  },
  record: string,
): Required<Pick<FileSetState, "temporary" | "retained">> {
  const retain = unique(amendment.retain ?? []).filter(
    (path) => state.temporary?.has(path) === true,
  );
  const temporary = new Set([...(state.temporary ?? []), ...unique(amendment.temporary ?? [])]);
  for (const path of retain) temporary.delete(path);
  return {
    temporary,
    retained: [
      ...(state.retained ?? []),
      ...retain.map((path) => ({ path, reason: amendment.reason, record })),
    ],
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
  evidence: Pick<EvidenceRecorder, "records" | "payloads">,
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
