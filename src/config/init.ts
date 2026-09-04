import { join } from "node:path";
import { nodeScriptCandidates } from "../gates/default-gates.ts";
import type { GateSeverity, OverrideParserName } from "../gates/gate-definition.ts";
import { harnessReportingCommand } from "../gates/harness-reporting.ts";
import { detectProject, type ProjectDetection } from "../gates/project-type.ts";
import { swarmTomlFileName } from "./swarm-toml.ts";

/**
 * `swarm init`: a swarm.toml a first run can work from without editing, with its gates read
 * off the scripts package.json declares. Each gate names the rule the harness already has for
 * that script's runner, and a script whose runner the harness has no rule for is written
 * advisory with the reason above it, so the file says what will be measured and how before
 * anything runs.
 */
export interface PlannedGate {
  readonly id: string;
  /** The package.json script it came from, named in the comment above the line. */
  readonly script: string;
  readonly body: string;
  readonly command: string;
  readonly parser: OverrideParserName;
  readonly severity: GateSeverity;
  /** Why the gate is advisory, or null where the harness has a rule for its runner. */
  readonly reason: string | null;
}

/** The four the prompt of a first run is about, in the order the file lists them. */
const initScriptCandidates: readonly (readonly [string, readonly string[]])[] = [
  ["tests", nodeScriptCandidates.tests ?? []],
  ["lint", nodeScriptCandidates.lint ?? []],
  ["typecheck", nodeScriptCandidates.typecheck ?? []],
  ["build", ["build"]],
];

/**
 * Which rule reads a test script's output. Node's own runner is vouched for whole, so the
 * harness runs it with its own reporters; vitest prints a summary line the test-output rule
 * reads. Anything else prints in a shape this harness has no reader for, and the exit code is
 * the whole of what it can say.
 */
function testRunnerRule(body: string): {
  readonly parser: OverrideParserName;
  readonly severity: GateSeverity;
  readonly reason: string | null;
} {
  if (harnessReportingCommand(body) !== null) {
    return { parser: "test-output", severity: "blocking", reason: null };
  }
  const program = body.trim().split(/\s+/)[0] ?? "";
  if (program === "vitest") {
    return { parser: "test-output", severity: "blocking", reason: null };
  }
  return {
    parser: "exit-code",
    severity: "advisory",
    reason:
      `the harness has no parser for ${program.length === 0 ? "this runner" : program}'s ` +
      "output, so this gate reads the exit code only and is advisory",
  };
}

export function planGates(detection: ProjectDetection): readonly PlannedGate[] {
  const planned: PlannedGate[] = [];
  for (const [id, candidates] of initScriptCandidates) {
    const script = candidates.find((name) => detection.nodeScripts.includes(name));
    if (script === undefined) {
      continue;
    }
    const body = detection.nodeScriptCommands[script] ?? "";
    const rule =
      id === "tests"
        ? testRunnerRule(body)
        : { parser: "exit-code" as const, severity: "blocking" as const, reason: null };
    planned.push({ id, script, body, command: `npm run --silent ${script}`, ...rule });
  }
  return planned;
}

/** One line of a TOML comment: no newline can be smuggled into it by a script body. */
function commentLine(text: string): string {
  return `# ${text.replaceAll(/[\r\n]+/g, " ")}`;
}

export function renderSwarmToml(plan: readonly PlannedGate[], detection: ProjectDetection): string {
  const lines = [
    "# Written by swarm init. Each gate below replaces the one the harness would assemble on its",
    "# own from package.json; delete a line to fall back to that. Flags win over this file.",
    "",
  ];
  if (!detection.manifests.includes("package.json")) {
    lines.push(
      commentLine(
        "no package.json in this directory: gates are assembled at run time from whatever manifests are present",
      ),
      "",
    );
    return lines.join("\n");
  }
  lines.push("[gates]");
  for (const gate of plan) {
    lines.push(commentLine(`from package.json scripts.${gate.script}: ${gate.body}`));
    if (gate.reason !== null) {
      lines.push(commentLine(gate.reason));
    }
    const fields = [
      `command = ${JSON.stringify(gate.command)}`,
      `parser = ${JSON.stringify(gate.parser)}`,
      ...(gate.severity === "advisory" ? ['severity = "advisory"'] : []),
    ];
    lines.push(`${gate.id} = { ${fields.join(", ")} }`);
  }
  if (plan.length === 0) {
    lines.push(
      commentLine(
        "package.json declares none of test, lint, typecheck or build, so there is nothing to write here",
      ),
    );
  }
  lines.push("");
  return lines.join("\n");
}

export class SwarmTomlExistsError extends Error {
  constructor(path: string) {
    super(
      `${path} already exists. swarm init writes a new file and never edits one: delete it, or` +
        " edit it by hand.",
    );
    this.name = "SwarmTomlExistsError";
  }
}

export interface InitDependencies {
  readonly workspace: string;
  readonly exists: (path: string) => Promise<boolean>;
  /** The file's text, or null where it does not exist. */
  readonly readFile: (path: string) => Promise<string | null>;
  readonly writeFile: (path: string, text: string) => Promise<void>;
}

export interface InitOutcome {
  readonly path: string;
  readonly gates: readonly PlannedGate[];
}

/** Writes swarm.toml where there is none, from what the manifests declare. */
export async function initializeSwarmToml(deps: InitDependencies): Promise<InitOutcome> {
  const path = join(deps.workspace, swarmTomlFileName);
  if (await deps.exists(path)) {
    throw new SwarmTomlExistsError(path);
  }
  const detection = await detectProject((manifest) =>
    deps.readFile(join(deps.workspace, manifest)),
  );
  const gates = planGates(detection);
  await deps.writeFile(path, renderSwarmToml(gates, detection));
  return { path, gates };
}

/** Whether a first run should offer to write the file: none yet, and a manifest to read. */
export async function initWouldHelp(
  deps: Pick<InitDependencies, "workspace" | "exists">,
): Promise<boolean> {
  return (
    !(await deps.exists(join(deps.workspace, swarmTomlFileName))) &&
    (await deps.exists(join(deps.workspace, "package.json")))
  );
}
