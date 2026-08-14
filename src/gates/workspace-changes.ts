/** What the gates see of the working tree: which files moved away from the base, and how. */

export type ChangeKind = "added" | "modified" | "deleted";

export interface AddedLine {
  /** Line number in the file as it stands now, so a coverage report can be intersected. */
  readonly line: number;
  readonly text: string;
}

export interface ChangedFile {
  /** Workspace-relative and slash-separated, whatever the host platform writes. */
  readonly path: string;
  readonly kind: ChangeKind;
  readonly addedLines: readonly AddedLine[];
  readonly removedLines: readonly string[];
}

export interface WorkspaceChanges {
  /** The commit the diff is taken against. Every measure in a run shares one base. */
  readonly baseRef: string;
  readonly files: readonly ChangedFile[];
}

export const noChanges: WorkspaceChanges = { baseRef: "unknown", files: [] };

/** The workspace as it stood, so a rejected attempt can be undone rather than argued with. */
export interface CapturedWorkspace {
  readonly label: string;
  /** Path to contents, with null meaning the file did not exist at capture time. */
  readonly files: ReadonlyMap<string, string | null>;
}

export interface WorkspaceCheckpoint {
  capture(label: string): Promise<CapturedWorkspace>;
  restore(captured: CapturedWorkspace): Promise<void>;
}

/** Reads the working tree and the base it is being judged against. */
export interface WorkspaceProbe {
  changes(): Promise<WorkspaceChanges>;
  /** Current contents, or null when the file does not exist now. */
  readCurrent(path: string): Promise<string | null>;
  /** Contents at the base commit, or null when the file did not exist there. */
  readBase(path: string): Promise<string | null>;
}

export function changedPaths(changes: WorkspaceChanges): readonly string[] {
  return changes.files.map((file) => file.path);
}

export function changedTestPaths(
  changes: WorkspaceChanges,
  isTest: (path: string) => boolean,
): readonly string[] {
  return changedPaths(changes).filter(isTest);
}

export function countAddedLines(changes: WorkspaceChanges): number {
  return changes.files.reduce((total, file) => total + file.addedLines.length, 0);
}

export function countRemovedLines(changes: WorkspaceChanges): number {
  return changes.files.reduce((total, file) => total + file.removedLines.length, 0);
}
