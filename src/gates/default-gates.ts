import {
  type GateDefinition,
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
  readonly parse?: GateParser;
}

function commandGate(spec: GateSpec): GateDefinition {
  return {
    id: spec.id,
    title: spec.title,
    severity: spec.severity,
    source: { kind: "command", command: spec.command },
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

function nodeGates(detection: ProjectDetection): readonly GateDefinition[] {
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
    return commandGate({
      id,
      title: `${id} (npm run ${script})`,
      severity: "blocking",
      command: `npm run --silent ${script}`,
    });
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
  Record<ProjectType, (detection: ProjectDetection) => readonly GateDefinition[]>
> = {
  node: nodeGates,
  python: pythonGates,
  rust: () => rustGates,
  go: () => goGates,
};

/**
 * No manifest means no language gates can be assembled, and the set says so rather than
 * shrinking quietly: four gates that never ran must not look like four gates that passed.
 */
const undetectedGates: readonly GateDefinition[] = (
  ["typecheck", "lint", "format", "tests"] as const
).map((id) =>
  unavailableGate(
    id,
    id,
    "blocking",
    "no package.json, pyproject.toml, Cargo.toml, or go.mod was found in the workspace root",
  ),
);

export interface GateSetOptions {
  /** Replaces the assembled command for one gate id, from swarm.toml or a flag. */
  readonly commandOverrides?: Readonly<Record<string, string>>;
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
          commandGatesByType[type](detection).map((gate) =>
            multiple ? { ...gate, id: `${gate.id}:${type}` } : gate,
          ),
        );

  const assembled = [...language, ...inspectionGates];

  return assembled.map((gate) => {
    const override = overrides[gate.id];
    if (override === undefined) {
      return gate;
    }
    return { ...gate, source: { kind: "command", command: override } };
  });
}
