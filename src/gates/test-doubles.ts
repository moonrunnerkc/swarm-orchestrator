import type { CommandOptions, GateCommandRunner, GateObservation } from "./gate-definition.ts";
import type { BaseControlRunner, ControlOutcome, ControlRun } from "./respecification.ts";
import type {
  AddedLine,
  CapturedWorkspace,
  ChangedFile,
  WorkspaceChanges,
  WorkspaceCheckpoint,
  WorkspaceProbe,
} from "./workspace-changes.ts";

/**
 * Doubles for the gates' three ambient dependencies: the working tree, the shell, and the
 * base-source control runs. Shipped beside the sources for the same reason the fixture
 * provider is: the engine's behaviour under a rejected retry is the thing worth testing,
 * and it should not need a real repository to test it.
 */

export interface MemoryWorkspace extends WorkspaceProbe {
  write(path: string, text: string | null): void;
  readonly files: ReadonlyMap<string, string>;
}

interface MemoryWorkspaceOptions {
  readonly base?: Readonly<Record<string, string>>;
  readonly current?: Readonly<Record<string, string>>;
  readonly baseRef?: string;
}

export function createMemoryWorkspace(options: MemoryWorkspaceOptions = {}): MemoryWorkspace {
  const base = new Map(Object.entries(options.base ?? {}));
  const current = new Map(Object.entries(options.current ?? options.base ?? {}));
  const baseRef = options.baseRef ?? "base";

  return {
    files: current,

    write(path: string, text: string | null): void {
      if (text === null) {
        current.delete(path);
        return;
      }
      current.set(path, text);
    },

    changes(): Promise<WorkspaceChanges> {
      const paths = [...new Set([...base.keys(), ...current.keys()])].sort();
      const files: ChangedFile[] = [];
      for (const path of paths) {
        const before = base.get(path);
        const after = current.get(path);
        if (before === after) {
          continue;
        }
        files.push({
          path,
          kind: before === undefined ? "added" : after === undefined ? "deleted" : "modified",
          addedLines: differingLines(after ?? "", before ?? ""),
          removedLines: differingLines(before ?? "", after ?? "").map((line) => line.text),
        });
      }
      return Promise.resolve({ baseRef, files });
    },

    readCurrent: (path) => Promise.resolve(current.get(path) ?? null),
    readBase: (path) => Promise.resolve(base.get(path) ?? null),
  };
}

export function createMemoryCheckpoint(workspace: MemoryWorkspace): WorkspaceCheckpoint {
  return {
    capture(label: string): Promise<CapturedWorkspace> {
      return Promise.resolve({
        label,
        files: new Map<string, string | null>(workspace.files),
      });
    },
    restore(captured: CapturedWorkspace): Promise<void> {
      for (const path of [...workspace.files.keys()]) {
        if (!captured.files.has(path)) {
          workspace.write(path, null);
        }
      }
      for (const [path, contents] of captured.files) {
        workspace.write(path, contents);
      }
      return Promise.resolve();
    },
  };
}

interface StubCommandRunner extends GateCommandRunner {
  readonly commands: readonly string[];
}

export function createStubCommandRunner(
  respond: (command: string) => Partial<GateObservation>,
): StubCommandRunner {
  const commands: string[] = [];
  return {
    commands,
    run(command: string, _options: CommandOptions): Promise<GateObservation> {
      commands.push(command);
      const response = respond(command);
      return Promise.resolve({
        exitCode: response.exitCode ?? 0,
        stdout: response.stdout ?? "",
        stderr: response.stderr ?? "",
        durationMs: response.durationMs ?? 1,
        unavailable: response.unavailable ?? null,
      });
    },
  };
}

interface StubControlOutcomes {
  readonly onBase: ControlOutcome;
  readonly onSubmitted: ControlOutcome;
}

export function createStubBaseControl(
  outcomes: (testFile: string) => StubControlOutcomes | null,
): BaseControlRunner {
  const run = (outcome: ControlOutcome | undefined): ControlRun => ({
    outcome: outcome ?? "indeterminate",
    detail: "stub control",
    exitCode: outcome === "passed" ? 0 : outcome === "failed" ? 1 : null,
  });

  return {
    runOnBaseSource: (testFile) => Promise.resolve(run(outcomes(testFile)?.onBase)),
    runOnSubmittedSource: (testFile) => Promise.resolve(run(outcomes(testFile)?.onSubmitted)),
  };
}

/**
 * Lines present in `after` beyond what `before` holds, keeping their position in `after`.
 * A multiset comparison, which is enough to drive a gate that reads added lines.
 */
function differingLines(after: string, before: string): readonly AddedLine[] {
  const remaining = new Map<string, number>();
  for (const line of before.split("\n")) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }

  const added: AddedLine[] = [];
  after.split("\n").forEach((text, index) => {
    const left = remaining.get(text) ?? 0;
    if (left > 0) {
      remaining.set(text, left - 1);
      return;
    }
    added.push({ line: index + 1, text });
  });
  return added;
}
