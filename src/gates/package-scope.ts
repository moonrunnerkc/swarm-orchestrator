import { z } from "zod";
import { assembleGates, type GateSetOptions } from "./default-gates.ts";
import type { GateDefinition } from "./gate-definition.ts";
import { inspectionGates } from "./inspection-gates.ts";
import { detectEnvironment } from "./project-environment.ts";
import { detectProject, type ManifestReader, type ProjectDetection } from "./project-type.ts";

const packagePath = z
  .string()
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/)
  .refine((value) =>
    value
      .split("/")
      .every((part) => part !== ".." && part !== "." && part !== "" && part !== ".git"),
  );

/** Validate explicit repository-relative units, rejecting overlapping scopes. */
export function packageSelection(values: readonly string[]): readonly string[] {
  const paths = z.array(packagePath).min(1).max(64).parse(values);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((path, index) =>
      paths.some((other, at) => index !== at && path.startsWith(`${other}/`)),
    )
  )
    throw new Error("package selection contains duplicate or overlapping units");
  return paths;
}

/** A selected subset cannot certify any changed path outside its units. */
export function outsidePackages(
  paths: readonly string[],
  packages: readonly string[],
): readonly string[] {
  const units = packageSelection(packages);
  return paths.filter((path) => !units.some((unit) => path.startsWith(`${unit}/`)));
}

/** Assemble checks from each pinned manifest, with package-qualified identities and directories. */
export async function assemblePackageGates(
  read: ManifestReader,
  options: GateSetOptions,
): Promise<{
  detection: ProjectDetection;
  gates: readonly GateDefinition[];
}> {
  const units = packageSelection(options.packages ?? []);
  const environment = await detectEnvironment(read);
  const detections: ProjectDetection[] = [];
  const gates: GateDefinition[] = [
    {
      id: "package-scope",
      title: "selected package scope",
      severity: "blocking",
      capability: "policy",
      parserName: "inspection",
      source: {
        kind: "inspection",
        inspect: async (context) => {
          const outside = outsidePackages(
            context.changes.files.map((file) => file.path),
            units,
          );
          return {
            exitCode: outside.length ? 1 : 0,
            stdout: "",
            stderr: outside.join(", "),
            durationMs: 0,
            unavailable: null,
          };
        },
      },
      parse: (observation) => ({
        status: observation.exitCode === 0 ? "passed" : "failed",
        detail:
          observation.exitCode === 0
            ? "all changed paths are inside selected units"
            : `outside selected units: ${observation.stderr}; expand the scope`,
        measures: {},
      }),
    },
  ];
  for (const unit of units) {
    const detection = {
      ...environment,
      ...(await detectProject((path) => read(`${unit}/${path}`))),
    };
    if (detection.types.length === 0)
      throw new Error(`selected package ${unit} has no supported manifest`);
    if (detection.types.some((type) => type !== "node" && type !== "python"))
      throw new Error(
        `explicit package selection supports Node and Python; ${unit} needs repository-wide Go/Rust verification`,
      );
    detections.push(detection);
    for (const gate of assembleGates(detection, options)) {
      if (gate.source.kind !== "command") continue;
      gates.push({
        ...gate,
        id: `${gate.id}:${unit}`,
        title: `${unit}: ${gate.title}`,
        source: {
          kind: "command",
          command: `cd '${unit}' && ${gate.source.command}`,
          coverageUnmeasured:
            "package-scoped commands do not claim controlled changed-line coverage or base-control attribution",
        },
      });
    }
  }
  return {
    detection: {
      types: [...new Set(detections.flatMap((detection) => detection.types))],
      manifests: detections.flatMap((detection, index) =>
        detection.manifests.map((path) => `${units[index]}/${path}`),
      ),
      nodeScripts: [],
      nodeScriptCommands: {},
      pythonTools: [],
    },
    gates: [...gates, ...inspectionGates],
  };
}
