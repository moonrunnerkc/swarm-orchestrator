import { isolatedCoverageShortfall } from "../node-floor.ts";
import { commandGate, type GateSpec, unavailableGate } from "./gate-command.ts";
import type { GateDefinition } from "./gate-definition.ts";
import { harnessReportingCommand } from "./harness-reporting.ts";
import { readNoninteractive } from "./noninteractive-runner.ts";
import type { ProjectDetection } from "./project-type.ts";
import { readRunnerResult } from "./runner-results.ts";
import { renderRunnerArgv, structuredRunner } from "./structured-runner.ts";

export const nodeScriptCandidates: Readonly<Record<string, readonly string[]>> = {
  typecheck: ["typecheck", "type-check", "tsc"],
  lint: ["lint", "lint:check"],
  // A formatter gate must check, never write: a gate that edits the tree is not a gate.
  format: ["format:check", "fmt:check", "format:ci", "lint:format"],
  tests: ["test", "tests"],
  build: ["build"],
};

/**
 * The ratchet's changed-line-coverage arm can only compare what a run measured, so a test
 * command that leaves no report behind keeps that arm permanently abstaining, which reads as
 * a pass. Where the declared runner is node's own, the gate runs a vector the harness built
 * itself, which writes the runner's own report to a path under the session store, and the
 * harness reads that file rather than anything the run printed. Every other runner reports
 * coverage in a shape this harness does not read, and asking for it can fail outright, so
 * those runs are recorded as not measured instead of guessed at.
 *
 * The gate then carries both: the vector, which is what runs, and its rendering, which is what
 * the ledger and the screen show. They are not the same thing and the difference matters, since
 * nothing re-reads the rendering.
 *
 * One rule, applied to whatever command the gate ends up running: the script a manifest
 * declares here, and an override from swarm.toml where there is one.
 *
 * The vector carries `--test-isolation=process`, which the runtime has to accept: below that
 * floor the project's own command runs instead, and the gate says why no report was asked for,
 * so the arm abstains with the reason named rather than spawning a runner that exits on a bad
 * option and reading that as a failed suite.
 */
export function askedForHarnessReports(
  spec: GateSpec,
  body: string | undefined,
  nodeVersion: string,
): GateSpec {
  const structured = structuredRunner(body);
  if (structured !== null)
    return {
      ...spec,
      argv: structured,
      parse: readRunnerResult,
      parserName: "structured-test-output",
      command: renderRunnerArgv(structured),
      coverageUnmeasured:
        "runner-reported results grant no controlled coverage or base-control attribution",
    };
  const shortfall = isolatedCoverageShortfall(nodeVersion);
  if (shortfall !== null) {
    // Only where the runner is one the harness could otherwise have vouched for: a body a
    // shell decides is not measured for its own reason, and that reason is not the runtime.
    return harnessReportingCommand(body, "v24.0.0") === null
      ? spec
      : { ...spec, coverageUnmeasured: shortfall };
  }
  const argv = harnessReportingCommand(body, nodeVersion);
  if (argv === null) {
    return spec;
  }
  const rendered = argv.join(" ");
  return {
    ...spec,
    title: `${spec.id} (${rendered})`,
    command: rendered,
    argv,
  };
}

/** Assemble Node checks from declared scripts and the selected manager. */
export function nodeGates(
  detection: ProjectDetection,
  nodeVersion: string,
): readonly GateDefinition[] {
  // Scripts run through npm whichever manager installed the lockfile: the script is the same
  // shell text under either, node_modules/.bin is on its PATH either way, and npm is present
  // wherever node is, while pnpm is fetched for the install command alone and is not in a
  // trusted image (every pnpm project's typecheck, lint and build read "not installed" there).
  const manager = "npm";
  const scripts = new Set(detection.nodeScripts);
  const pick = (id: string): string | null =>
    (nodeScriptCandidates[id] ?? []).find((name) => scripts.has(name)) ?? null;

  // Build first, the order a project's own CI conventionally runs in: install, build, then lint,
  // typecheck and tests. Every later check can read what the build writes: a suite exercises a
  // bundle or a worker's asset directory, a workspace package's `tsc --noEmit` resolves its
  // siblings through their built `.d.ts` files, and a type-aware lint rule does the same. Run
  // before the build, each of those fails on a tree that was never built, and that failure is
  // the harness's order, not the change. Nothing the build reads is written by a later check,
  // so running it first costs no check its input.
  return (
    [
      ...(scripts.has("build") ? ["build" as const] : []),
      "typecheck",
      "lint",
      "format",
      "tests",
    ] as const
  ).map((id) => {
    if (detection.setupProblem) return unavailableGate(id, id, "blocking", detection.setupProblem);
    const script = pick(id);
    // A test script that asks for watch mode by name would wait for changes until the gate's
    // timeout killed it, and a kill reads as a failed suite. It is recorded as a check the
    // project declared no unattended way to run, with the override named, rather than run
    // under a flag the project did not declare.
    const interactive =
      id === "tests" && script !== null
        ? readNoninteractive(detection.nodeScriptCommands[script]).interactive
        : null;
    if (interactive !== null) {
      return unavailableGate(
        id,
        `${id} (${manager} run ${script})`,
        "blocking",
        `${interactive}. Declare a script that runs once, or name the command to run with --command`,
      );
    }
    if (script === null) {
      return unavailableGate(
        id,
        `${id} (node)`,
        "blocking",
        id === "format"
          ? "package.json declares no check-only format script, and running a writing formatter " +
              "as a gate would edit the tree it is judging"
          : `package.json declares no ${id} script`,
        id !== "tests",
      );
    }
    return commandGate(
      askedForHarnessReports(
        {
          id,
          title: `${id} (${manager} run ${script})`,
          severity: "blocking",
          command: `${manager} run --silent ${script}`,
        },
        detection.nodeScriptCommands[script],
        nodeVersion,
      ),
    );
  });
}
