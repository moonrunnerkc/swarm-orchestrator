import { detectEnvironment, type ProjectEnvironment } from "./project-environment.ts";
export type ProjectType = "node" | "python" | "rust" | "go";

export interface ProjectDetection extends ProjectEnvironment {
  /** Every type whose manifest is present. A repo may honestly be more than one. */
  readonly types: readonly ProjectType[];
  readonly manifests: readonly string[];
  /** Script names declared in package.json, empty for every other project type. */
  readonly nodeScripts: readonly string[];
  /**
   * What each of those scripts actually runs. The gate set needs the body, not just the
   * name, to know whether it can ask the runner for a coverage report.
   */
  readonly nodeScriptCommands: Readonly<Record<string, string>>;
  /** Tool sections found in Python manifests, so gates are assembled only when configured. */
  readonly pythonTools: readonly string[];
  readonly pythonMypyTargetsConfigured?: boolean;
}

const manifestsByType: Readonly<Record<ProjectType, readonly string[]>> = {
  node: ["package.json"],
  python: ["pyproject.toml", "setup.cfg", "setup.py"],
  rust: ["Cargo.toml"],
  go: ["go.mod"],
};

/** Reads a workspace file, or null when it is not there. */
export type ManifestReader = (path: string) => Promise<string | null>;

/**
 * Detection is presence of a manifest, nothing cleverer. What the manifest declares then
 * decides which gates are real commands and which are recorded as not-applicable, so a
 * project never gets a gate that was going to fail for want of a script.
 */
export async function detectProject(read: ManifestReader): Promise<ProjectDetection> {
  const types: ProjectType[] = [];
  const manifests: string[] = [];
  let nodeScriptCommands: Readonly<Record<string, string>> = {};
  let pythonTools: readonly string[] = [];
  let pythonMypyTargetsConfigured = false;

  for (const [type, candidates] of Object.entries(manifestsByType) as [
    ProjectType,
    readonly string[],
  ][]) {
    for (const manifest of candidates) {
      const text = await read(manifest);
      if (text === null) continue;
      if (!types.includes(type)) types.push(type);
      manifests.push(manifest);
      if (type === "node") nodeScriptCommands = readNodeScripts(text);
      if (type === "python" && manifest !== "setup.py") {
        pythonTools = [...new Set([...pythonTools, ...readPythonTools(text)])].sort();
        pythonMypyTargetsConfigured ||= hasMypyTargets(manifest, text);
      }
    }
  }

  if (types.includes("python")) {
    for (const file of ["pytest.ini", "tox.ini"]) {
      const text = await read(file);
      if (text !== null && /^\s*\[pytest\]\s*$/m.test(text))
        pythonTools = [...new Set([...pythonTools, "pytest"])].sort();
    }
  }
  return {
    ...(await detectEnvironment(read)),
    types,
    manifests,
    nodeScripts: Object.keys(nodeScriptCommands).sort(),
    nodeScriptCommands,
    pythonTools,
    ...(pythonMypyTargetsConfigured ? { pythonMypyTargetsConfigured: true } : {}),
  };
}

const configuredMypyTargets = z.object({
  tool: z.object({
    mypy: z.object({ files: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]) }),
  }),
});

function hasMypyTargets(manifest: string, text: string): boolean {
  if (manifest === "setup.cfg") {
    const section = /^\s*\[mypy\]\s*$([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m.exec(text)?.[1];
    return section !== undefined && /^\s*files\s*=\s*\S/m.test(section);
  }
  try {
    return configuredMypyTargets.safeParse(parse(text)).success;
  } catch {
    return false;
  }
}

function readNodeScripts(text: string): Readonly<Record<string, string>> {
  try {
    const parsed = JSON.parse(text) as { scripts?: Record<string, unknown> };
    const scripts: Record<string, string> = {};
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
      scripts[name] = typeof command === "string" ? command : "";
    }
    return scripts;
  } catch {
    // A package.json that does not parse still identifies the project; it just declares nothing.
    return {};
  }
}

function readPythonTools(text: string): readonly string[] {
  const tools = new Set<string>();
  for (const match of text.matchAll(/^\s*\[tool\.([A-Za-z0-9_-]+)/gm)) {
    const tool = match[1];
    if (tool !== undefined) {
      tools.add(tool);
    }
  }
  if (/^\s*\[mypy\]\s*$/m.test(text)) tools.add("mypy");
  if (/^\s*\[tool:pytest\]\s*$/m.test(text)) tools.add("pytest");
  try {
    const data = z
      .object({
        project: z
          .object({
            dependencies: z.array(z.string()).optional(),
            "optional-dependencies": z.record(z.string(), z.array(z.string())).optional(),
          })
          .optional(),
        "dependency-groups": z.record(z.string(), z.array(z.unknown())).optional(),
      })
      .parse(parse(text));
    const dependencies = [
      ...(data.project?.dependencies ?? []),
      ...Object.values(data.project?.["optional-dependencies"] ?? {}).flat(),
      ...Object.values(data["dependency-groups"] ?? {}).flat(),
    ];
    for (const dependency of dependencies) {
      if (typeof dependency !== "string") continue;
      const name = /^(pytest|ruff|mypy)(?=[\s[<>=!~;]|$)/i.exec(dependency)?.[1]?.toLowerCase();
      if (name !== undefined) tools.add(name);
    }
  } catch {
    /* INI configuration is read by its section names above. */
  }
  return [...tools].sort();
}

import { parse } from "smol-toml";
import { z } from "zod";
