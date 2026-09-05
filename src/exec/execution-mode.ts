import { tmpdir } from "node:os";
import { childEnvironment, defaultChildHome } from "./child-environment.ts";
import { type ProcessRunResult, runProcessGroup } from "./run-process.ts";

/**
 * What actually stands between a command the model wrote and the machine it runs on.
 *
 * `isolated` is a kernel-enforced filesystem, process and network boundary that has passed the
 * self-test below. `restricted` is a lexical path and program policy: it reads the command and
 * rules on the words that could name a file, which is a real check and is not containment,
 * because an interpreter on the allowlist will run whatever a workspace script says. `unsafe`
 * is host execution the operator asked for.
 *
 * The word "guard" is not used for `restricted` anywhere a person reads it. Lexical filtering
 * in front of a Turing-complete interpreter is not a guard, and calling it one is the part
 * that makes a reader stop checking.
 */
export type ExecutionMode = "isolated" | "restricted" | "unsafe";

/** Somewhere a command can be run. The host is one; a container boundary would be another. */
export interface IsolationBackend {
  readonly name: string;
  run(
    argv: readonly string[],
    options: { readonly cwd: string; readonly timeoutMs: number },
  ): Promise<ProcessRunResult>;
}

export interface ContainmentProbe {
  readonly id: string;
  /** What the probe tried to reach, in the words a reader would use. */
  readonly attempted: string;
  readonly contained: boolean;
  /** What came back. Present where the probe got through, so the escape is legible. */
  readonly observed: string;
}

export interface ContainmentSelfTest {
  readonly backend: string;
  readonly mode: ExecutionMode;
  readonly probes: readonly ContainmentProbe[];
  readonly summary: string;
}

export interface SelfTestOptions {
  readonly workspaceRoot: string;
  /** A file the harness owns outside the workspace, used as the thing a probe must not read. */
  readonly hostFileOutsideWorkspace: string;
  readonly timeoutMs?: number | undefined;
}

/** The host, with nothing in front of it. What every run gets today. */
export const hostExecutionBackend: IsolationBackend = {
  name: "host",
  run: (argv, options) => {
    const [program, ...args] = argv;
    if (program === undefined) {
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 127,
        timedOut: false,
        cancelled: false,
        truncated: false,
        startFailure: "the probe was handed an empty vector",
      });
    }
    return runProcessGroup(program, args, {
      cwd: options.cwd,
      env: childEnvironment(process.env, { homeDir: defaultChildHome() }).variables,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: 64_000,
    });
  },
};

/**
 * Runs the escapes rather than reasoning about them. A backend claims containment; this asks it
 * to prove it by trying to read a host file outside the workspace, to write outside the
 * workspace, and to open a network connection. Anything that gets through is named.
 */
export async function selfTestContainment(
  backend: IsolationBackend,
  options: SelfTestOptions,
): Promise<ContainmentSelfTest> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const probes = await Promise.all([
    runProbe(backend, options, timeoutMs, {
      id: "host-file-read",
      attempted: `reading ${options.hostFileOutsideWorkspace}, which is outside the workspace`,
      script: `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(options.hostFileOutsideWorkspace)}, "utf8"))`,
    }),
    runProbe(backend, options, timeoutMs, {
      id: "host-file-write",
      attempted: "writing a file outside the workspace",
      script: `const p=require("node:path").join(${JSON.stringify(tmpdir())},"swarm-containment-probe.txt");require("node:fs").writeFileSync(p,"reached");process.stdout.write("wrote "+p)`,
    }),
    runProbe(backend, options, timeoutMs, {
      id: "network-egress",
      attempted: "opening a network connection to a host outside the machine",
      script:
        'const s=require("node:net").connect(443,"example.com");' +
        's.setTimeout(4000);s.on("connect",()=>{process.stdout.write("connected");s.destroy()});' +
        's.on("error",()=>process.stderr.write("refused"));s.on("timeout",()=>{process.stderr.write("timed out");s.destroy()})',
    }),
  ]);

  const escaped = probes.filter((probe) => !probe.contained);
  const mode: ExecutionMode = escaped.length === 0 ? "isolated" : "restricted";
  const summary =
    escaped.length === 0
      ? `${backend.name} refused every probe, so this run is isolated.`
      : `${backend.name} has no kernel-enforced boundary in front of it: ${escaped
          .map((probe) => probe.id)
          .join(", ")} got through. Commands are ruled on by a lexical path and program ` +
        "policy, which is a real check and is not a sandbox.";

  return { backend: backend.name, mode, probes, summary };
}

async function runProbe(
  backend: IsolationBackend,
  options: SelfTestOptions,
  timeoutMs: number,
  probe: { readonly id: string; readonly attempted: string; readonly script: string },
): Promise<ContainmentProbe> {
  const ran = await backend.run([process.execPath, "-e", probe.script], {
    cwd: options.workspaceRoot,
    timeoutMs,
  });
  // Contained means the attempt did not succeed. A probe that could not start at all is not
  // evidence of containment, so it counts as uncontained and says why.
  const contained = ran.exitCode !== 0 || ran.stdout.trim().length === 0;
  return {
    id: probe.id,
    attempted: probe.attempted,
    contained,
    observed: contained ? "" : ran.stdout.trim(),
  };
}

export interface ExecutionEnvelope {
  readonly mode: ExecutionMode;
  readonly backend: string;
  readonly writablePaths: readonly string[];
  readonly readOnlyPaths: readonly string[];
  readonly network: "denied" | "unrestricted";
  readonly environmentPolicy: "built" | "inherited";
  /** How many names the parent held that the child did not get. */
  readonly credentialNamesWithheld: number;
  /** Whether configuration the repository controls was allowed to decide anything. */
  readonly repositoryConfigTrusted: boolean;
  readonly probes: readonly ContainmentProbe[];
  readonly summary: string;
}

/**
 * What a run executes under, stated rather than left to be inferred. This is what the CLI
 * prints before the first tool call and what the bundle carries, so a reader never has to work
 * out from the absence of a warning that there was no boundary.
 */
export function describeExecutionEnvelope(input: {
  readonly selfTest: ContainmentSelfTest;
  readonly workspaceRoot: string;
  readonly withheldEnvironmentNames: readonly string[];
  readonly repositoryConfigTrusted: boolean;
  readonly readOnlyPaths?: readonly string[] | undefined;
}): ExecutionEnvelope {
  const networkEscaped = input.selfTest.probes.some(
    (probe) => probe.id === "network-egress" && !probe.contained,
  );
  return {
    mode: input.selfTest.mode,
    backend: input.selfTest.backend,
    writablePaths: [input.workspaceRoot],
    readOnlyPaths: input.readOnlyPaths ?? [],
    network: networkEscaped ? "unrestricted" : "denied",
    environmentPolicy: "built",
    credentialNamesWithheld: input.withheldEnvironmentNames.length,
    repositoryConfigTrusted: input.repositoryConfigTrusted,
    probes: input.selfTest.probes,
    summary: input.selfTest.summary,
  };
}
