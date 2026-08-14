import { dirname, join } from "node:path";
import { defaultGateTimeoutMs, type GateCommandRunner } from "./gate-definition.ts";
import { type GitWorkspaceOptions, revertSourceToBase } from "./git-workspace.ts";
import { isTestFile } from "./measures.ts";
import { parseTapOutcomes, parseTestOutcomes } from "./parsers.ts";
import type { ProjectDetection } from "./project-type.ts";
import { type BaseControlRunner, type ControlRun, indeterminate } from "./respecification.ts";

/**
 * The escape hatch's two controls, run for real. Reverting the source in place rather than
 * checking out a second tree keeps the installed dependencies, which is what makes "the
 * test failed on base" a statement about the code instead of about the environment.
 *
 * Which tests failed there is read from a result the runner wrote to a path the harness
 * named, not from the reporter output a person reads. The distinction is the same one the
 * coverage arm makes: a spec-reporter line is text a test can print, and a test that prints
 * one for a sibling used to hand itself that sibling's failure, which is what buys a
 * deletion. Nothing a test prints reaches a TAP result point, because the runner folds
 * captured output into comments.
 */

/** Reads back what a control run was told to write, and clears it first. */
interface ControlArtifactStore {
  clear(path: string): Promise<void>;
  read(path: string): Promise<string | null>;
}

interface BaseControlOptions {
  readonly workspace: GitWorkspaceOptions;
  readonly commands: GateCommandRunner;
  /** Null when the project has no way to run one test file, which withholds every exemption. */
  readonly singleFileCommand: (testFile: string, outcomeArtifact: string | null) => string | null;
  /**
   * Where a control run is asked to write its own machine-readable result, under the session
   * store that invariant 11 keeps outside the workspace. Absent means no result is asked for
   * and attribution falls back to reading what the run printed.
   */
  readonly outcomeArtifacts?: {
    readonly directory: string;
    readonly store: ControlArtifactStore;
  };
  readonly timeoutMs?: number;
}

/** One control run's result path, per test file, so two files cannot read each other's. */
export function controlOutcomePath(directory: string, testFile: string): string {
  return join(directory, `${testFile.replaceAll(/[^A-Za-z0-9._-]+/g, "-")}.tap`);
}

export function createBaseControlRunner(options: BaseControlOptions): BaseControlRunner {
  const timeoutMs = options.timeoutMs ?? defaultGateTimeoutMs;
  const artifacts = options.outcomeArtifacts;

  const runOne = async (testFile: string): Promise<ControlRun> => {
    const artifactPath =
      artifacts === undefined ? null : controlOutcomePath(artifacts.directory, testFile);
    const command = options.singleFileCommand(testFile, artifactPath);
    if (command === null) {
      return indeterminate("this project has no command that runs one test file on its own");
    }
    // Cleared first, so a result left by the run before cannot pass as this one's.
    if (artifacts !== undefined && artifactPath !== null) {
      await artifacts.store.clear(artifactPath);
    }
    const observation = await options.commands.run(command, {
      cwd: options.workspace.workspaceRoot,
      timeoutMs,
    });
    if (observation.unavailable !== null) {
      return indeterminate(observation.unavailable);
    }

    // The output is carried into the detail, not summarized away: the refuter reads it to
    // tell a file that failed as a specification from one that never loaded at all, and a
    // reviewer opening the record sees the same bytes that verdict was reached from.
    const output = `${observation.stdout}\n${observation.stderr}`.trim();
    const reported =
      artifacts === undefined || artifactPath === null
        ? null
        : await artifacts.store.read(artifactPath);
    const outcomes = reported === null ? parseTestOutcomes(output) : parseTapOutcomes(reported);
    return {
      outcome: observation.exitCode === 0 ? "passed" : "failed",
      detail: `${command} exited ${observation.exitCode}${output.length === 0 ? "" : `\n${truncate(output)}`}`,
      exitCode: observation.exitCode,
      failedTests: outcomes === null ? null : outcomes.failed,
    };
  };

  return {
    async runOnBaseSource(testFile: string): Promise<ControlRun> {
      let swap: Awaited<ReturnType<typeof revertSourceToBase>>;
      try {
        swap = await revertSourceToBase(
          options.workspace,
          // The submitted test stays; every other change goes back to the base commit.
          (path) => path === testFile,
        );
      } catch (cause) {
        return indeterminate(
          `the base source could not be staged: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      try {
        return await runOne(testFile);
      } finally {
        await swap.restore();
      }
    },

    runOnSubmittedSource: (testFile: string) => runOne(testFile),
  };
}

/**
 * How to run exactly one test file, per project type. Null wherever the toolchain has no
 * such notion, and null withholds the exemption rather than guessing at one.
 */
export function singleFileTestCommand(
  detection: ProjectDetection,
  testFile: string,
  outcomeArtifact: string | null = null,
): string | null {
  if (!isTestFile(testFile)) {
    return null;
  }
  if (detection.types.includes("node") && detection.nodeScripts.includes("test")) {
    const asked = outcomeFlags(detection.nodeScriptCommands.test, outcomeArtifact);
    return `npm test --silent -- ${asked}${quote(testFile)}`;
  }
  if (detection.types.includes("python")) {
    return `pytest -q ${quote(testFile)}`;
  }
  if (detection.types.includes("go")) {
    return `go test ./${quote(dirname(testFile))}/...`;
  }
  // Rust compiles a crate's tests together, so there is no single-file run to make.
  return null;
}

/**
 * The flags that make node's own runner write a machine-readable result beside the output it
 * prints. npm hands them to the script ahead of the file, which is where node accepts them:
 * after a file pattern they are ignored. The printed stream is kept as well, because the
 * refuter reads it to tell a file that failed as a specification from one that never loaded.
 * Process isolation goes with them for the same reason it does on the coverage cycle: a test
 * sharing the reporter's process can write the result the harness is about to read.
 *
 * Empty for a test script that is not node's runner, or that already names a reporter of its
 * own. Empty means attribution falls back to reading what the run printed, which is weaker
 * and is what the fallback in parsers.ts is scoped to.
 */
function outcomeFlags(body: string | undefined, artifact: string | null): string {
  if (artifact === null || body === undefined || body.includes("--test-reporter")) {
    return "";
  }
  if (!/\bnode\b[^\n]*?\s--test(?![\w-])/.test(body)) {
    return "";
  }
  return (
    "--test-reporter=tap --test-reporter-destination=stdout " +
    `--test-reporter=tap --test-reporter-destination=${quote(artifact)} ` +
    "--test-isolation=process "
  );
}

/** Enough to name every test and the reason a load failed, short enough for a ledger record. */
function truncate(output: string): string {
  return output.length <= 8_000 ? output : `${output.slice(0, 8_000)}\n[truncated]`;
}

function quote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}
