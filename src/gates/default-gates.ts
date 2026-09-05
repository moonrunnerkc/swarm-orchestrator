import { nearestName } from "../edit-distance.ts";
import {
  type GateContext,
  type GateDefinition,
  type GateObservation,
  type GateOverride,
  type GateParser,
  type GateSeverity,
  type OverrideParserName,
  type ParserName,
  unavailableObservation,
} from "./gate-definition.ts";
import { harnessReportingCommand } from "./harness-reporting.ts";
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
  /** Named beside `parse` where a parser is supplied, so the record says which rule read it. */
  readonly parserName?: ParserName;
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
    },
    parse: spec.parse ?? parserFor(spec.id),
    parserName: spec.parserName ?? parserNameFor(spec.id),
  };
}

/**
 * Which parser reads which gate, by id. A parser belongs to the kind of output a gate
 * produces, not to whether the project happened to declare a way to run it, so an
 * unavailable gate and an overridden command both keep the right reader.
 */
const parsersById: Readonly<Record<string, GateParser>> = { tests: testOutputParser };
const parserNamesById: Readonly<Record<string, OverrideParserName>> = { tests: "test-output" };

function parserFor(id: string): GateParser {
  return parsersById[id] ?? exitCodeParser;
}

function parserNameFor(id: string): OverrideParserName {
  return parserNamesById[id] ?? "exit-code";
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
    parserName: parserNameFor(id),
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

export const nodeScriptCandidates: Readonly<Record<string, readonly string[]>> = {
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
function askedForHarnessReports(spec: GateSpec, body: string | undefined): GateSpec {
  const argv = harnessReportingCommand(body);
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
    return commandGate(
      askedForHarnessReports(
        {
          id,
          title: `${id} (npm run ${script})`,
          severity: "blocking",
          command: `npm run --silent ${script}`,
        },
        detection.nodeScriptCommands[script],
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
    parserName: "no-output",
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
  node: (detection) => nodeGates(detection),
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
  /**
   * Replaces the assembled gate for one id, from swarm.toml or a flag, or adds a gate under an
   * id the assembled set has no slot for, such as `build`.
   */
  readonly commandOverrides?: Readonly<Record<string, GateOverride>>;
}

const parserByName: Readonly<Record<OverrideParserName, GateParser>> = {
  "exit-code": exitCodeParser,
  "test-output": testOutputParser,
  "no-output": noOutputParser,
};

/**
 * The script body an npm invocation names, or null where the command is anything else. An
 * override written as `npm run --silent test` runs the manifest's script, so the question of
 * whether the harness can vouch for the invocation is a question about that script's body,
 * exactly as it is for the gate the assembler builds from the same script.
 */
export function scriptBodyBehind(command: string, detection: ProjectDetection): string | null {
  const trimmed = command.trim();
  const named =
    /^npm\s+(?:run|run-script)\s+(?:--silent\s+|-s\s+)?([A-Za-z0-9:._-]+)$/.exec(trimmed)?.[1] ??
    (/^npm\s+(?:test|t)$/.test(trimmed) ? "test" : null);
  return named === null ? null : (detection.nodeScriptCommands[named] ?? null);
}

function overriddenGate(
  id: string,
  title: string,
  severity: GateSeverity,
  override: GateOverride,
  detection: ProjectDetection,
): GateDefinition {
  const settled = typeof override === "string" ? { command: override } : override;
  const parserName = settled.parser ?? parserNameFor(id);
  return commandGate(
    askedForHarnessReports(
      {
        id,
        title,
        severity: settled.severity ?? severity,
        command: settled.command,
        // The named rule, or the id's own: an overridden gate runs a command, and where the
        // replaced one was a stub standing in for a language nothing detected, its parser
        // answers about the absence of a command rather than about the output of one.
        parse: parserByName[parserName],
        parserName,
      },
      scriptBodyBehind(settled.command, detection) ?? settled.command,
    ),
  );
}

/**
 * The language gates first, then the four that hold whatever the language is. A polyglot
 * repo gets one set per manifest, with the type in the gate id so two "tests" gates stay
 * distinguishable in the ledger.
 */
/** A gate override whose id is one edit or two from a gate the set assembled. */
export class UnknownGateOverrideError extends Error {
  readonly nearMisses: readonly { readonly id: string; readonly meant: string }[];

  constructor(nearMisses: readonly { readonly id: string; readonly meant: string }[]) {
    super(
      `swarm.toml declares gate override(s) under id(s) the assembled set does not have, ` +
        `each of which is close to one it does: ` +
        nearMisses.map((one) => `"${one.id}" (did you mean "${one.meant}"?)`).join(", ") +
        ". An override under an unrecognised id adds a new blocking gate rather than " +
        "replacing one, so a misspelling runs both. Correct the id, or pick one that is not " +
        "a near miss if a new gate is what you meant.",
    );
    this.name = "UnknownGateOverrideError";
    this.nearMisses = nearMisses;
  }
}

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

  const replaced = assembled.map((gate) => {
    const override = overrides[gate.id];
    return override === undefined
      ? gate
      : overriddenGate(gate.id, gate.title, gate.severity, override, detection);
  });
  const assembledIds = assembled.map((gate) => gate.id);
  const unmatched = Object.keys(overrides).filter((id) => !assembledIds.includes(id));

  // An id nothing resembles adds a gate, which is a real feature: a project with a build step
  // wants it checked. A near miss is a different thing. `tets` intending `tests` added a second
  // blocking gate and left the assembled tests gate running its own command, so the run did
  // more work than the author asked for and none of the work they meant.
  const nearMisses = unmatched
    .map((id) => ({ id, meant: nearestName(id, assembledIds) }))
    .filter((entry): entry is { id: string; meant: string } => entry.meant !== null);
  if (nearMisses.length > 0) {
    throw new UnknownGateOverrideError(nearMisses);
  }

  const added = unmatched
    .sort((left, right) => (left < right ? -1 : 1))
    .map((id) => overriddenGate(id, id, "blocking", overrides[id] as GateOverride, detection));
  return [...replaced, ...added];
}
