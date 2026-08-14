import { dirname } from "node:path";
import { defaultGateTimeoutMs, type GateCommandRunner } from "./gate-definition.ts";
import { type GitWorkspaceOptions, revertSourceToBase } from "./git-workspace.ts";
import { isTestFile } from "./measures.ts";
import { parseTestOutcomes } from "./parsers.ts";
import type { ProjectDetection } from "./project-type.ts";
import { type BaseControlRunner, type ControlRun, indeterminate } from "./respecification.ts";

/**
 * The escape hatch's two controls, run for real. Reverting the source in place rather than
 * checking out a second tree keeps the installed dependencies, which is what makes "the
 * test failed on base" a statement about the code instead of about the environment.
 */

interface BaseControlOptions {
  readonly workspace: GitWorkspaceOptions;
  readonly commands: GateCommandRunner;
  /** Null when the project has no way to run one test file, which withholds every exemption. */
  readonly singleFileCommand: (testFile: string) => string | null;
  readonly timeoutMs?: number;
}

export function createBaseControlRunner(options: BaseControlOptions): BaseControlRunner {
  const timeoutMs = options.timeoutMs ?? defaultGateTimeoutMs;

  const runOne = async (testFile: string): Promise<ControlRun> => {
    const command = options.singleFileCommand(testFile);
    if (command === null) {
      return indeterminate("this project has no command that runs one test file on its own");
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
    const outcomes = parseTestOutcomes(output);
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
): string | null {
  if (!isTestFile(testFile)) {
    return null;
  }
  if (detection.types.includes("node") && detection.nodeScripts.includes("test")) {
    return `npm test --silent -- ${quote(testFile)}`;
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

/** Enough to name every test and the reason a load failed, short enough for a ledger record. */
function truncate(output: string): string {
  return output.length <= 8_000 ? output : `${output.slice(0, 8_000)}\n[truncated]`;
}

function quote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}
