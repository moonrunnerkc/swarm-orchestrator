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
  /**
   * The formatter the project declares, and the file that declares it. Absent where nothing
   * declares one: ruff configuration alone configures its linter, not its formatter.
   */
  readonly pythonFormatter?: PythonFormatter;
  /**
   * Which configured tools the project's own environment holds, read from `.venv` without
   * running anything. Absent when there is no `.venv` to read, and then nothing is claimed.
   */
  readonly pythonToolsInstalled?: readonly string[];
}

export interface PythonFormatter {
  readonly tool: "ruff" | "black";
  readonly declaredBy: "pyproject.toml" | ".pre-commit-config.yaml";
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

  let pythonToolsInstalled: readonly string[] | undefined;
  let pythonFormatter: PythonFormatter | undefined;
  if (types.includes("python")) {
    pythonFormatter = await declaredFormatter(read);
    for (const file of ["pytest.ini", "tox.ini"]) {
      const text = await read(file);
      if (text !== null && /^\s*\[pytest\]\s*$/m.test(text))
        pythonTools = [...new Set([...pythonTools, "pytest"])].sort();
    }
    // A configured tool the environment does not hold makes `python -m tool` exit 1 with
    // "No module named", which read as the check failing. Its presence is a file in the
    // environment's site-packages, read here like any manifest; the interpreter's minor
    // version is whichever directory exists.
    if ((await read(".venv/pyvenv.cfg")) !== null) {
      const installed: string[] = [];
      const expected = [
        ...new Set([...pythonTools, ...(pythonFormatter ? [pythonFormatter.tool] : [])]),
      ];
      for (const tool of expected.sort()) {
        let present = false;
        for (let minor = 8; minor <= 15 && !present; minor += 1)
          present =
            (await read(`.venv/lib/python3.${minor}/site-packages/${tool}/__init__.py`)) !== null;
        if (present) installed.push(tool);
      }
      pythonToolsInstalled = installed;
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
    ...(pythonToolsInstalled === undefined ? {} : { pythonToolsInstalled }),
    ...(pythonFormatter === undefined ? {} : { pythonFormatter }),
  };
}

const formatterTables = z.object({
  tool: z
    .object({
      ruff: z.object({ format: z.record(z.string(), z.unknown()).optional() }).optional(),
      black: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

/**
 * A formatter is checked only where the project says it formats with it: a `[tool.ruff.format]`
 * or `[tool.black]` table, or a pre-commit hook that runs it. The gate set holds one format
 * check, so where both are declared ruff's declaration is the one read, and the check's title
 * names the formatter it runs.
 */
async function declaredFormatter(read: ManifestReader): Promise<PythonFormatter | undefined> {
  let tables: z.infer<typeof formatterTables> = {};
  const pyproject = await read("pyproject.toml");
  if (pyproject !== null) {
    try {
      tables = formatterTables.parse(parse(pyproject));
    } catch {
      // A malformed pyproject.toml is a setup problem, reported by the environment reading.
    }
  }
  const hooks = new Set<string>();
  const preCommit = await read(".pre-commit-config.yaml");
  for (const match of (preCommit ?? "").matchAll(
    /^[ \t]*(?:-[ \t]+)?id:[ \t]*["']?([A-Za-z0-9_-]+)["']?[ \t]*(?:#.*)?$/gm,
  ))
    if (match[1] !== undefined) hooks.add(match[1]);
  if (tables.tool?.ruff?.format !== undefined)
    return { tool: "ruff", declaredBy: "pyproject.toml" };
  if (hooks.has("ruff-format")) return { tool: "ruff", declaredBy: ".pre-commit-config.yaml" };
  if (tables.tool?.black !== undefined) return { tool: "black", declaredBy: "pyproject.toml" };
  if (hooks.has("black") || hooks.has("black-jupyter"))
    return { tool: "black", declaredBy: ".pre-commit-config.yaml" };
  return undefined;
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
