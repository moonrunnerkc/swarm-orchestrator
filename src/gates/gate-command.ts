import {
  type GateDefinition,
  type GateParser,
  type GateSeverity,
  type OverrideParserName,
  type ParserName,
  unavailableObservation,
} from "./gate-definition.ts";
import { exitCodeParser, testOutputParser } from "./parsers.ts";

export interface GateSpec {
  readonly id: string;
  readonly title: string;
  readonly severity: GateSeverity;
  readonly command: string;
  /** Set where the harness built the invocation itself and spawns it with no shell. */
  readonly argv?: readonly string[];
  /** Set where the harness could have built that invocation and the runtime cannot run it. */
  readonly coverageUnmeasured?: string;
  readonly parse?: GateParser;
  /** Named beside `parse` where a parser is supplied, so the record says which rule read it. */
  readonly parserName?: ParserName;
}

/** Build a command check with its recorded parser identity. */
export function commandGate(spec: GateSpec): GateDefinition {
  return {
    id: spec.id,
    title: spec.title,
    severity: spec.severity,
    source: {
      kind: "command",
      command: spec.command,
      ...(spec.argv === undefined ? {} : { argv: spec.argv }),
      ...(spec.coverageUnmeasured === undefined
        ? {}
        : { coverageUnmeasured: spec.coverageUnmeasured }),
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

/** Name the default parser for a declared check identity. */
export function parserNameFor(id: string): OverrideParserName {
  return parserNamesById[id] ?? "exit-code";
}

/** A gate the project declared no way to run. Recorded, never silently dropped. */
export function unavailableGate(
  id: string,
  title: string,
  severity: GateSeverity,
  reason: string,
  optionalAbsence = false,
): GateDefinition {
  return {
    id,
    title,
    severity,
    source: {
      kind: "inspection",
      unavailableReason: reason,
      optionalAbsence,
      inspect: async () => unavailableObservation(reason),
    },
    parse: parserFor(id),
    parserName: parserNameFor(id),
  };
}

/** gofmt and friends pass by printing nothing, so the exit code alone would call it green. */
export const noOutputParser: GateParser = (observation) => {
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
