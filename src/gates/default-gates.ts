import { coverageArtifactPath, coverageReportingCommand } from "./coverage-artifact.ts";
import {
  type GateContext,
  type GateDefinition,
  type GateObservation,
  type GateParser,
  type GateSeverity,
  unavailableObservation,
} from "./gate-definition.ts";
import { inspectionGates } from "./inspection-gates.ts";
import { exitCodeParser, testOutputParser } from "./parsers.ts";
import type { ProjectDetection, ProjectType } from "./project-type.ts";

/**
 * The default gate set, assembled from what the manifests declare. Everything here is a
 * value: no branch in the engine knows that "tests" is special, and swapping a command or
 * a parser is an edit to this table (invariant 6).
 */

interface GateSpec {
  readonly id: string;
  readonly title: string;
  readonly severity: GateSeverity;
  readonly command: string;
  /** Set where the harness built the invocation itself and spawns it with no shell. */
  readonly argv?: readonly string[];
  readonly parse?: GateParser;
  /** Where this run's runner was told to write its coverage report, when it was. */
  readonly coverageArtifact?: string;
}

function commandGate(spec: GateSpec): GateDefinition {
  return {
    id: spec.id,
    title: spec.title,
    severity: spec.severity,
    source: {
      kind: "command",
      command: spec.command,
      ...(spec.argv === undefined ? {} : { argv: spec.argv }),
      ...(spec.coverageArtifact === undefined ? {} : { coverageArtifact: spec.coverageArtifact }),
    },
    parse: spec.parse ?? parserFor(spec.id),
  };
}

/**
 * Which parser reads which gate, by id. A parser belongs to the kind of output a gate
 * produces, not to whether the project happened to declare a way to run it, so an
 * unavailable gate and an overridden command both keep the right reader.
 */
const parsersById: Readonly<Record<string, GateParser>> = { tests: testOutputParser };

function parserFor(id: string): GateParser {
  return parsersById[id] ?? exitCodeParser;
}

/** A gate the project declared no way to run. Recorded, never silently dropped. */
function unavailableGate(
  id: string,
  title: string,
  severity: GateSeverity,
  reason: string,
): GateDefinition {
  return {
    id,
    title,
    severity,
    source: { kind: "inspection", inspect: async () => unavailableObservation(reason) },
    parse: parserFor(id),
  };
}

/** gofmt and friends pass by printing nothing, so the exit code alone would call it green. */
const noOutputParser: GateParser = (observation) => {
  const offenders = observation.stdout.trim();
  if (observation.exitCode !== 0) {
    return {
      status: "failed",
      detail: `the command exited ${observation.exitCode}`,
      measures: {},
    };
  }
  return offenders.length === 0
    ? { status: "passed", detail: "the command listed no offending file", measures: {} }
    : {
        status: "failed",
        detail: `the command listed ${offenders.split("\n").length} offending file(s)`,
        measures: {},
      };
};

const nodeScriptCandidates: Readonly<Record<string, readonly string[]>> = {
  typecheck: ["typecheck", "type-check", "tsc"],
  lint: ["lint", "lint:check"],
  // A formatter gate must check, never write: a gate that edits the tree is not a gate.
  format: ["format:check", "fmt:check", "format:ci", "lint:format"],
  tests: ["test", "tests"],
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
 */
function askedForCoverage(
  spec: GateSpec,
  body: string | undefined,
  directory: string | undefined,
): GateSpec {
  if (directory === undefined) {
    return spec;
  }
  const artifact = coverageArtifactPath(directory, spec.id);
  const argv = coverageReportingCommand(body, artifact);
  if (argv === null) {
    return spec;
  }
  const rendered = argv.join(" ");
  return {
    ...spec,
    title: `${spec.id} (${rendered})`,
    command: rendered,
    argv,
    coverageArtifact: artifact,
  };
}

function nodeGates(
  detection: ProjectDetection,
  options: GateSetOptions,
): readonly GateDefinition[] {
  const scripts = new Set(detection.nodeScripts);
  const pick = (id: string): string | null =>
    (nodeScriptCandidates[id] ?? []).find((name) => scripts.has(name)) ?? null;

  return (["typecheck", "lint", "format", "tests"] as const).map((id) => {
    const script = pick(id);
    if (script === null) {
      return unavailableGate(
        id,
        `${id} (node)`,
        "blocking",
        id === "format"
          ? "package.json declares no check-only format script, and running a writing formatter " +
              "as a gate would edit the tree it is judging"
          : `package.json declares no ${id} script`,
      );
    }
    return commandGate(
      askedForCoverage(
        {
          id,
          title: `${id} (npm run ${script})`,
          severity: "blocking",
          command: `npm run --silent ${script}`,
        },
        detection.nodeScriptCommands[script],
        options.coverageArtifactDirectory,
      ),
    );
  });
}

function pythonGates(detection: ProjectDetection): readonly GateDefinition[] {
  const tools = new Set(detection.pythonTools);
  const gates: GateDefinition[] = [];

  gates.push(
    tools.has("mypy")
      ? commandGate({
          id: "typecheck",
          title: "typecheck (mypy)",
          severity: "blocking",
          command: "mypy .",
        })
      : unavailableGate(
          "typecheck",
          "typecheck (python)",
          "blocking",
          "pyproject.toml configures no type checker",
        ),
  );
  gates.push(
    tools.has("ruff")
      ? commandGate({
          id: "lint",
          title: "lint (ruff)",
          severity: "blocking",
          command: "ruff check .",
        })
      : unavailableGate("lint", "lint (python)", "blocking", "pyproject.toml configures no linter"),
  );
  gates.push(
    tools.has("ruff")
      ? commandGate({
          id: "format",
          title: "format (ruff format --check)",
          severity: "blocking",
          command: "ruff format --check .",
        })
      : unavailableGate(
          "format",
          "format (python)",
          "blocking",
          "pyproject.toml configures no formatter",
        ),
  );
  gates.push(
    commandGate({
      id: "tests",
      title: "tests (pytest)",
      severity: "blocking",
      command: "pytest -q",
    }),
  );

  return gates;
}

const rustGates: readonly GateDefinition[] = [
  commandGate({
    id: "typecheck",
    title: "typecheck (cargo check)",
    severity: "blocking",
    command: "cargo check --all-targets",
  }),
  commandGate({
    id: "lint",
    title: "lint (cargo clippy)",
    severity: "blocking",
    command: "cargo clippy --all-targets -- -D warnings",
  }),
  commandGate({
    id: "format",
    title: "format (cargo fmt --check)",
    severity: "blocking",
    command: "cargo fmt --all --check",
  }),
  commandGate({
    id: "tests",
    title: "tests (cargo test)",
    severity: "blocking",
    command: "cargo test",
  }),
];

const goGates: readonly GateDefinition[] = [
  commandGate({
    id: "typecheck",
    title: "typecheck (go build)",
    severity: "blocking",
    command: "go build ./...",
  }),
  commandGate({
    id: "lint",
    title: "lint (go vet)",
    severity: "blocking",
    command: "go vet ./...",
  }),
  commandGate({
    id: "format",
    title: "format (gofmt -l)",
    severity: "blocking",
    command: "gofmt -l .",
    parse: noOutputParser,
  }),
  commandGate({
    id: "tests",
    title: "tests (go test)",
    severity: "blocking",
    command: "go test ./...",
  }),
];

const commandGatesByType: Readonly<
  Record<
    ProjectType,
    (detection: ProjectDetection, options: GateSetOptions) => readonly GateDefinition[]
  >
> = {
  node: nodeGates,
  python: pythonGates,
  rust: () => rustGates,
  go: () => goGates,
};

const noManifestReason =
  "no package.json, pyproject.toml, Cargo.toml, or go.mod was found in the workspace root";

/**
 * No manifest means no language gates can be assembled, and the set says so rather than
 * shrinking quietly: four gates that never ran must not look like four gates that passed.
 *
 * Over a change, saying so is not enough. Not-applicable was read as satisfied, so a run that
 * wrote 142 lines of Python into a directory with no manifest went green over a file that
 * could not even be imported, because nothing had tried to. A change nothing can measure is a
 * failure with an action attached rather than a gate quietly standing down, and the action is
 * the one thing that fixes it: write the manifest for the language being written. Over an
 * unchanged tree it stays not-applicable, because there is nothing there to measure either way.
 */
const undetectedGates: readonly GateDefinition[] = (
  ["typecheck", "lint", "format", "tests"] as const
).map((id) => ({
  id,
  title: id,
  severity: "blocking" as const,
  source: {
    kind: "inspection" as const,
    inspect: async (context: GateContext): Promise<GateObservation> =>
      context.changes.files.length === 0
        ? unavailableObservation(noManifestReason)
        : {
            exitCode: 1,
            stdout: "",
            unavailable: null,
            stderr:
              `${noManifestReason}, so nothing ran over the ` +
              `${context.changes.files.length} file(s) this change touched. Add the manifest ` +
              "for the language being written, so the gates can measure it.",
            durationMs: 0,
          },
  },
  // Its own parser rather than the shared one: the shared parsers read a command's output,
  // and what this gate has to say is not a command's output but the reason there was no
  // command. Through `exitCodeParser` the reader got "the command exited 1".
  parse: (observation) =>
    observation.unavailable === null
      ? { status: "failed" as const, detail: observation.stderr, measures: {} }
      : { status: "not-applicable" as const, detail: observation.unavailable, measures: {} },
}));

export interface GateSetOptions {
  /** Replaces the assembled command for one gate id, from swarm.toml or a flag. */
  readonly commandOverrides?: Readonly<Record<string, string>>;
  /**
   * Where a test runner is asked to write its coverage report. It belongs outside the
   * workspace, which is what stops the code being measured from authoring the measurement;
   * absent means no report is asked for and the coverage arm abstains.
   */
  readonly coverageArtifactDirectory?: string;
}

/**
 * The language gates first, then the four that hold whatever the language is. A polyglot
 * repo gets one set per manifest, with the type in the gate id so two "tests" gates stay
 * distinguishable in the ledger.
 */
export function assembleGates(
  detection: ProjectDetection,
  options: GateSetOptions = {},
): readonly GateDefinition[] {
  const overrides = options.commandOverrides ?? {};
  const multiple = detection.types.length > 1;

  const language =
    detection.types.length === 0
      ? undetectedGates
      : detection.types.flatMap((type) =>
          commandGatesByType[type](detection, options).map((gate) =>
            multiple ? { ...gate, id: `${gate.id}:${type}` } : gate,
          ),
        );

  const assembled = [...language, ...inspectionGates];

  return assembled.map((gate) => {
    const override = overrides[gate.id];
    if (override === undefined) {
      return gate;
    }
    return commandGate(
      askedForCoverage(
        {
          id: gate.id,
          title: gate.title,
          severity: gate.severity,
          command: override,
          // The id's own parser, not whatever the gate being replaced was carrying. An
          // overridden gate runs a command, and where the replaced one was a stub standing in
          // for a language nothing detected, its parser answers about the absence of a command
          // rather than about the output of one.
          parse: parserFor(gate.id),
        },
        override,
        options.coverageArtifactDirectory,
      ),
    );
  });
}
