import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { defaultGateTimeoutMs, type GateCommandRunner } from "./gate-definition.ts";
import { type GitWorkspaceOptions, revertSourceToBase } from "./git-workspace.ts";
import { isTestFile } from "./measures.ts";
import { harnessControlledNodeTest, processIsolation, shellQuoted } from "./node-test-command.ts";
import { parseTapOutcomes } from "./parsers.ts";
import type { ProjectDetection } from "./project-type.ts";
import { type BaseControlRunner, type ControlRun, indeterminate } from "./respecification.ts";

/**
 * The escape hatch's two controls, run for real. Reverting the source in place rather than
 * checking out a second tree keeps the installed dependencies, which is what makes "the
 * test failed on base" a statement about the code instead of about the environment.
 *
 * Which tests failed there is read from the TAP artifact this harness asked node's own runner
 * to write, at a path this harness named, and from nothing else. Not from the output a person
 * reads: a reporter line is text a test can print, and a test that printed one for a sibling
 * used to hand that sibling a failure it never had, which is what buys a deletion. Nothing a
 * test prints reaches a TAP result point, because the runner folds captured output into
 * comments.
 *
 * And only where this harness asked for that artifact. The artifact is read when the command
 * being run is the one the harness built to write it; a run that was never asked leaves the
 * question unanswered rather than answered by whatever happens to sit at the path.
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
   * store that invariant 11 keeps outside the workspace. Absent means no result is asked for,
   * so no test is attributed a failure and no test is cleared.
   */
  readonly outcomeArtifacts?: {
    readonly directory: string;
    readonly store: ControlArtifactStore;
  };
  readonly timeoutMs?: number;
}

/**
 * One control run's result path, per test file, so two files cannot read each other's.
 *
 * The name carries a digest of the whole path because sanitizing the path into a filename is
 * not injective: `foo/bar.test.ts` and `foo-bar.test.ts` both sanitized to `foo-bar.test.ts`,
 * so one file's control run read the other's result, and a test that failed on base in one file
 * cleared a deletion in the other. The readable half is kept for whoever opens the session
 * store; the digest is what makes two files two paths.
 */
export function controlOutcomePath(directory: string, testFile: string): string {
  const readable = basename(testFile).replaceAll(/[^A-Za-z0-9._-]+/g, "-");
  const digest = createHash("sha256").update(testFile).digest("hex").slice(0, 16);
  return join(directory, `${readable}-${digest}.tap`);
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
    // reviewer opening the record sees the same bytes that verdict was reached from. It is
    // read to withhold an exemption, never to grant one, which is why a test printing into it
    // can only cost itself.
    const output = `${observation.stdout}\n${observation.stderr}`.trim();
    // Only a command that names the destination was asked to write it. Reading the path
    // regardless would attribute from a file this run never produced.
    const reported =
      artifacts !== undefined && artifactPath !== null && command.includes(artifactPath)
        ? await artifacts.store.read(artifactPath)
        : null;
    const outcomes = reported === null ? null : parseTapOutcomes(reported);
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
    const file = shellQuoted(testFile);
    if (file === null) {
      return null;
    }
    return (
      askedForOutcomes(detection.nodeScriptCommands.test, outcomeArtifact, file) ??
      // The run still happens without a result to read: whether the file passed or failed is
      // the file-level precondition, and it is answered by the exit code. What is missing is
      // which of its tests failed, so no test is cleared.
      `npm test --silent -- ${file}`
    );
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
 * The run that writes a machine-readable result, or null where this harness cannot vouch for
 * the invocation that would write it. Null is the fail-closed answer: no result, no attribution,
 * no test cleared.
 *
 * The command is built here rather than handed to `npm test`, and that is the point. npm runs
 * whatever `pretest` and `posttest` the workspace declares, in the process that surrounds the
 * one writing the artifact, and it appends these flags after the script's own file patterns,
 * where node ignores them. Both leave a path the harness named being written by something the
 * harness did not start. So the runner is started directly, with the project's own recognized
 * flags, this arm's reporters, and the one file under test in place of the project's patterns.
 *
 * The printed stream is kept beside the artifact because the refuter reads it to tell a file
 * that failed as a specification from one that never loaded.
 */
function askedForOutcomes(
  body: string | undefined,
  artifact: string | null,
  quotedTestFile: string,
): string | null {
  const destination = artifact === null ? null : shellQuoted(artifact);
  if (destination === null) {
    return null;
  }
  return harnessControlledNodeTest(
    body,
    [
      "--test-reporter=tap",
      "--test-reporter-destination=stdout",
      "--test-reporter=tap",
      `--test-reporter-destination=${destination}`,
      processIsolation,
    ],
    [quotedTestFile],
  );
}

/** Enough to name every test and the reason a load failed, short enough for a ledger record. */
function truncate(output: string): string {
  return output.length <= 8_000 ? output : `${output.slice(0, 8_000)}\n[truncated]`;
}

function quote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}
