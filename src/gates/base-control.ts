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
 * And only where this harness asked for that artifact and ran the thing it asked. The vouched
 * run is a vector spawned with no shell and under an environment built rather than inherited,
 * so nothing re-reads its arguments and no name the workspace set loads a hook into the process
 * writing the result. Where that cannot be built, the file is still run, by the fallback that
 * hands the declared script to a shell, and that run is asked for no artifact at all: it
 * answers whether the file passed and nothing about which of its tests did.
 */

/**
 * How one test file gets run. The two arms are not interchangeable and the type says so: only a
 * vector the harness built chose the reporter, so only that arm's stdout is a result to
 * attribute a failure from. The shell arm runs the file and answers with an exit code.
 */
export type TestFileInvocation =
  | { readonly kind: "argv"; readonly argv: readonly string[] }
  | { readonly kind: "shell"; readonly command: string };

export type SingleFileCommand = (testFile: string) => TestFileInvocation | null;

interface BaseControlOptions {
  readonly workspace: GitWorkspaceOptions;
  readonly commands: GateCommandRunner;
  /** Null when the project has no way to run one test file, which withholds every exemption. */
  readonly singleFileCommand: SingleFileCommand;
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

  const runOne = async (testFile: string): Promise<ControlRun> => {
    const invocation = options.singleFileCommand(testFile);
    if (invocation === null) {
      return indeterminate("this project has no command that runs one test file on its own");
    }
    const runOptions = { cwd: options.workspace.workspaceRoot, timeoutMs };
    const observation =
      invocation.kind === "argv"
        ? await options.commands.runVouched(invocation.argv, runOptions)
        : await options.commands.run(invocation.command, runOptions);
    if (observation.unavailable !== null) {
      return indeterminate(observation.unavailable);
    }

    // The output is carried into the detail, not summarized away: the refuter reads it to
    // tell a file that failed as a specification from one that never loaded at all, and a
    // reviewer opening the record sees the same bytes that verdict was reached from. It is
    // read to withhold an exemption, never to grant one, which is why a test printing into it
    // can only cost itself.
    const output = `${observation.stdout}\n${observation.stderr}`.trim();
    // Only the arm whose reporter the harness chose. The shell arm's stdout is whatever the
    // project's own command prints, and attributing a failure from that is reading a line a
    // test can write for the test beside it.
    const outcomes = invocation.kind === "argv" ? parseTapOutcomes(observation.stdout) : null;
    const ran = invocation.kind === "argv" ? invocation.argv.join(" ") : invocation.command;
    return {
      outcome: observation.exitCode === 0 ? "passed" : "failed",
      detail: `${ran} exited ${observation.exitCode}${output.length === 0 ? "" : `\n${truncate(output)}`}`,
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
): TestFileInvocation | null {
  if (!isTestFile(testFile)) {
    return null;
  }
  if (detection.types.includes("node") && detection.nodeScripts.includes("test")) {
    const asked = askedForOutcomes(detection.nodeScriptCommands.test, testFile);
    if (asked !== null) {
      return asked;
    }
    const file = shellQuoted(testFile);
    // The run still happens without a result to read: whether the file passed or failed is
    // the file-level precondition, and it is answered by the exit code. What is missing is
    // which of its tests failed, so no test is cleared.
    return file === null ? null : { kind: "shell", command: `npm test --silent -- ${file}` };
  }
  if (detection.types.includes("python")) {
    return { kind: "shell", command: `pytest -q ${quote(testFile)}` };
  }
  if (detection.types.includes("go")) {
    return { kind: "shell", command: `go test ./${quote(dirname(testFile))}/...` };
  }
  // Rust compiles a crate's tests together, so there is no single-file run to make.
  return null;
}

/**
 * The run whose result can be attributed, or null where this harness cannot vouch for the
 * invocation. Null is the fail-closed answer: no result, no attribution, no test cleared.
 *
 * The vector is built here rather than handed to `npm test`, and that is the point. npm runs
 * whatever `pretest` and `posttest` the workspace declares in the process surrounding the one
 * being read, and it appends these flags after the script's own file patterns, where node
 * ignores them. So the runner is started directly, with the project's own recognized flags,
 * this arm's reporter, and the one file under test in place of the project's patterns.
 *
 * The TAP goes to stdout, which the harness reads off the pipe it owns, and not to a file. A
 * destination path is an argument of the spawned process, `ps` hands it to any test that asks
 * for it, and the file is writable by anything running as the same user: a test that hammered
 * such a path left a torn result that attributed nothing, which withholds every exemption in
 * this file at the tests' own choosing. Under process isolation a test's own output is captured
 * by the parent and folded into the reporter's stream as escaped comments, so nothing a test
 * prints reaches column zero, which is the only place a result point is read from.
 */
function askedForOutcomes(body: string | undefined, testFile: string): TestFileInvocation | null {
  const argv = harnessControlledNodeTest(
    body,
    ["--test-reporter=tap", "--test-reporter-destination=stdout", processIsolation],
    [testFile],
  );
  return argv === null ? null : { kind: "argv", argv };
}

/** Enough to name every test and the reason a load failed, short enough for a ledger record. */
function truncate(output: string): string {
  return output.length <= 8_000 ? output : `${output.slice(0, 8_000)}\n[truncated]`;
}

function quote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}
