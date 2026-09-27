import { commandGate, unavailableGate } from "./gate-command.ts";
import type { GateDefinition } from "./gate-definition.ts";
import type { ProjectDetection } from "./project-type.ts";
import { readRunnerResult } from "./runner-results.ts";
import { renderRunnerArgv, structuredRunner } from "./structured-runner.ts";

/** Assemble configured Python checks using the project interpreter. */
export function pythonGates(detection: ProjectDetection): readonly GateDefinition[] {
  const tools = new Set(detection.pythonTools);
  const gates: GateDefinition[] = [];

  gates.push(
    tools.has("mypy")
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
        ),
  );
  gates.push(
    tools.has("ruff")
      ? commandGate({
          id: "lint",
          title: "lint (ruff)",
          severity: "blocking",
          command: "ruff check --no-fix .",
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
    tools.has("pytest")
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
