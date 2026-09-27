import { commandGate, unavailableGate } from "./gate-command.ts";
import type { GateDefinition } from "./gate-definition.ts";
import type { ProjectDetection } from "./project-type.ts";
import { readRunnerResult } from "./runner-results.ts";
import { renderRunnerArgv, structuredRunner } from "./structured-runner.ts";

/** Assemble configured Python checks using the project interpreter. */
export function pythonGates(detection: ProjectDetection): readonly GateDefinition[] {
  const tools = new Set(detection.pythonTools);
  const gates: GateDefinition[] = [];
  // Configured but not in the project's environment: the check cannot run, and saying so is
  // not a pass. Without a `.venv` to read nothing is known, and the gate is assembled as
  // configured; the plan's prerequisites name the missing environment first.
  const missing = (tool: string): boolean =>
    detection.pythonToolsInstalled !== undefined && !detection.pythonToolsInstalled.includes(tool);
  const notInstalled = (tool: string, id: string, title: string): GateDefinition =>
    unavailableGate(
      id,
      title,
      "blocking",
      `pyproject.toml configures ${tool}, but the project's environment does not hold it, so this check cannot run; add ${tool} to the project's development dependencies and sync`,
      false,
    );

  gates.push(
    tools.has("mypy") && missing("mypy")
      ? notInstalled("mypy", "typecheck", "typecheck (mypy)")
      : tools.has("mypy")
        ? commandGate({
            id: "typecheck",
            title: "typecheck (mypy)",
            severity: "blocking",
            command: detection.pythonMypyTargetsConfigured ? "mypy" : "mypy .",
          })
        : unavailableGate(
            "typecheck",
            "typecheck (python)",
            "blocking",
            "pyproject.toml configures no type checker",
            true,
          ),
  );
  gates.push(
    tools.has("ruff") && missing("ruff")
      ? notInstalled("ruff", "lint", "lint (ruff)")
      : tools.has("ruff")
        ? commandGate({
            id: "lint",
            title: "lint (ruff)",
            severity: "blocking",
            command: "ruff check --no-fix .",
          })
        : unavailableGate(
            "lint",
            "lint (python)",
            "blocking",
            "pyproject.toml configures no linter",
            true,
          ),
  );
  gates.push(
    tools.has("ruff") && missing("ruff")
      ? notInstalled("ruff", "format", "format (ruff format --check)")
      : tools.has("ruff")
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
            true,
          ),
  );
  gates.push(
    tools.has("pytest") && missing("pytest")
      ? notInstalled("pytest", "tests", "tests (pytest)")
      : tools.has("pytest")
        ? commandGate({
            id: "tests",
            title: "tests (pytest)",
            severity: "blocking",
            command: "pytest -q",
          })
        : unavailableGate(
            "tests",
            "tests (python)",
            "blocking",
            "project declares no pytest dependency or configuration",
          ),
  );

  if (detection.setupProblem)
    return gates.map((gate) =>
      unavailableGate(gate.id, gate.title, gate.severity, detection.setupProblem as string),
    );
  if (detection.pythonCommand)
    return gates.map((gate) =>
      gate.source.kind === "command"
        ? {
            ...gate,
            ...(structuredRunner(`${detection.pythonCommand} ${gate.source.command}`) === null
              ? {}
              : { parse: readRunnerResult, parserName: "structured-test-output" as const }),
            source: {
              ...gate.source,
              command: renderRunnerArgv(
                structuredRunner(`${detection.pythonCommand} ${gate.source.command}`) ?? [
                  "/bin/sh",
                  "-c",
                  `${detection.pythonCommand} ${gate.source.command}`,
                ],
              ),
              ...(structuredRunner(`${detection.pythonCommand} ${gate.source.command}`) === null
                ? {}
                : {
                    argv: structuredRunner(
                      `${detection.pythonCommand} ${gate.source.command}`,
                    ) as readonly string[],
                    coverageUnmeasured:
                      "pytest runner-reported outcomes do not grant ratchet measurement authority",
                  }),
            },
          }
        : gate,
    );
  return gates;
}
