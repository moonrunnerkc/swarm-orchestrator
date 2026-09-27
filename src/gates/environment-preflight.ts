import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { asJsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { GateCommandRunner, GateDefinition } from "./gate-definition.ts";
import { detectSelectedProject, packageSelection } from "./package-scope.ts";
import { detectProject, type ProjectDetection } from "./project-type.ts";

interface Probe {
  readonly name: string;
  readonly argv: readonly string[];
  readonly expected?: string;
}

function probes(detection: ProjectDetection): readonly Probe[] {
  if (detection.setupProblem) throw new Error(detection.setupProblem);
  const result: Probe[] = [];
  if (detection.types.includes("node")) {
    result.push({ name: "Node", argv: ["node", "--version"] });
    result.push({
      name: detection.nodeManager ?? "npm",
      argv: [detection.nodeManager ?? "npm", "--version"],
      ...(detection.nodeManagerVersion === undefined
        ? {}
        : { expected: detection.nodeManagerVersion.split("+")[0] }),
    });
    if (Object.values(detection.nodeScriptCommands).some((body) => /^vitest(?: run)?$/.test(body)))
      result.push({
        name: "Vitest",
        argv: [
          "node",
          "-e",
          "const fs=require('node:fs');const p=require.resolve('vitest/package.json',{paths:[process.cwd()]});console.log(JSON.parse(fs.readFileSync(p,'utf8')).version)",
        ],
      });
  }
  if (detection.types.includes("python") && detection.pythonTools.length) {
    const prefix = detection.pythonCommand;
    if (prefix === undefined)
      throw new Error(
        "configured Python checks need uv.lock or an existing .venv; prepare the environment before model spending",
      );
    const interpreter = prefix.startsWith("uv ")
      ? ["uv", "run", "--locked", "--no-sync", "python"]
      : [prefix.replace(/ -m$/, "")];
    if (prefix.startsWith("uv ")) result.push({ name: "uv", argv: ["uv", "--version"] });
    result.push({ name: "Python", argv: [...interpreter, "--version"] });
    for (const tool of ["pytest", "ruff", "mypy"].filter((name) =>
      detection.pythonTools.includes(name),
    ))
      result.push({
        name: tool,
        argv: [
          ...interpreter,
          "-I",
          "-c",
          `import importlib.metadata; print(importlib.metadata.version(${JSON.stringify(tool)}))`,
        ],
      });
  }
  return result;
}

/** Inspect installed tool identities without executing project scripts or preparing dependencies. */
export async function preflightEnvironment(options: {
  workspace: string;
  packages?: readonly string[];
  gates: readonly GateDefinition[];
  commands: GateCommandRunner;
  evidence: EvidenceRecorder;
  note: (text: string) => void;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<void> {
  const plan = options.gates
    .filter((gate) => gate.source.kind === "command")
    .map((gate) => ({
      id: gate.id,
      severity: gate.severity,
      command: gate.source.kind === "command" ? gate.source.command : "",
    }));
  await options.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["file"],
    payload: asJsonValue({ rule: "environment-plan-v1", checks: plan }),
  });
  for (const gate of plan) options.note(`${gate.id} (${gate.severity}): ${gate.command}`);
  const read = (path: string) => readFile(join(options.workspace, path), "utf8").catch(() => null);
  const units = options.packages?.length ? packageSelection(options.packages) : ["."];
  for (const unit of units) {
    const detection =
      unit === "." ? await detectProject(read) : await detectSelectedProject(read, unit);
    for (const probe of probes(detection)) {
      if (options.signal?.aborted) return;
      const identity = { rule: "environment-probe-v1", unit, name: probe.name, argv: probe.argv };
      await options.evidence.record({
        type: "verification-command",
        actor: "harness",
        provenance: ["file"],
        payload: asJsonValue({ ...identity, phase: "intent" }),
      });
      const observation = await options.commands.runVouched(probe.argv, {
        cwd: join(options.workspace, unit),
        timeoutMs: Math.max(1, Math.min(15000, options.timeoutMs)),
        maxOutputBytes: 16000,
      });
      const version = observation.stdout.trim();
      const ready =
        observation.exitCode === 0 &&
        observation.unavailable === null &&
        !observation.outputTruncated &&
        version.length > 0 &&
        (probe.expected === undefined || version === probe.expected);
      await options.evidence.record({
        type: "verification-command",
        actor: "harness",
        provenance: ["tool-output"],
        payload: asJsonValue({ ...identity, phase: "completed", observation, ready }),
      });
      if (options.signal?.aborted) return;
      if (!ready)
        throw new Error(
          `${unit}: ${probe.name} setup unavailable${probe.expected === undefined ? "" : `; declared version ${probe.expected}, observed ${version || "unknown"}`}. Prepare the declared environment before model spending: ${observation.unavailable ?? observation.stderr.slice(-2000)}`,
        );
      options.note(`${unit}: ${probe.name} ${version}`);
    }
  }
}
