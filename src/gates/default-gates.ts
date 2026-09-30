import { nearestName } from "../edit-distance.ts";
import { commandGate, noOutputParser, parserNameFor } from "./gate-command.ts";
import {
  type GateContext,
  type GateDefinition,
  type GateObservation,
  type GateOverride,
  type GateParser,
  type GateSeverity,
  type OverrideParserName,
  unavailableObservation,
} from "./gate-definition.ts";
import { askedForHarnessReports, nodeGates } from "./node-gates.ts";
import { pythonGates } from "./python-gates.ts";

export { nodeScriptCandidates } from "./node-gates.ts";

import { inspectionGates } from "./inspection-gates.ts";
import { exitCodeParser, testOutputParser } from "./parsers.ts";
import type { ProjectDetection, ProjectType } from "./project-type.ts";
import { readRunnerResult } from "./runner-results.ts";

/**
 * The default gate set, assembled from what the manifests declare. Everything here is a
 * value: no branch in the engine knows that "tests" is special, and swapping a command or
 * a parser is an edit to this table (invariant 6).
 */

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
  node: (detection, options) => nodeGates(detection, runtimeNodeVersion(options)),
  python: pythonGates,
  rust: () => rustGates,
  go: () => goGates,
};

export const noManifestReason =
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
  /** A controller-supplied sealed acceptance instrument, never repository configuration. */
  readonly acceptanceGate?: GateDefinition;
  readonly packages?: readonly string[];
  /**
   * Replaces the assembled gate for one id, from swarm.toml or a flag, or adds a gate under an
   * id the assembled set has no slot for, such as `build`.
   */
  readonly commandOverrides?: Readonly<Record<string, GateOverride>>;
  /**
   * The Node the gates will spawn node's runner with, which decides whether the coverage arm
   * can be asked for. Absent means the process assembling the gates, which is what runs them.
   */
  readonly nodeVersion?: string;
}

function runtimeNodeVersion(options: GateSetOptions): string {
  return options.nodeVersion ?? process.version;
}

const parserByName: Readonly<Record<OverrideParserName, GateParser>> = {
  "exit-code": exitCodeParser,
  "test-output": testOutputParser,
  "structured-test-output": readRunnerResult,
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
    /^(?:npm|pnpm)\s+(?:run|run-script)\s+(?:--silent\s+|-s\s+|--loglevel=error\s+)?([A-Za-z0-9:._-]+)$/.exec(
      trimmed,
    )?.[1] ?? (/^npm\s+(?:test|t)$/.test(trimmed) ? "test" : null);
  return named === null ? null : (detection.nodeScriptCommands[named] ?? null);
}

function overriddenGate(
  id: string,
  title: string,
  severity: GateSeverity,
  override: GateOverride,
  detection: ProjectDetection,
  nodeVersion: string,
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
      nodeVersion,
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
  const nodeVersion = runtimeNodeVersion(options);
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
      : overriddenGate(gate.id, gate.title, gate.severity, override, detection, nodeVersion);
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
    .map((id) =>
      overriddenGate(id, id, "blocking", overrides[id] as GateOverride, detection, nodeVersion),
    );
  return [...replaced, ...added];
}
