export type ProjectType = "node" | "python" | "rust" | "go";

export interface ProjectDetection {
  /** Every type whose manifest is present. A repo may honestly be more than one. */
  readonly types: readonly ProjectType[];
  readonly manifests: readonly string[];
  /** Script names declared in package.json, empty for every other project type. */
  readonly nodeScripts: readonly string[];
  /** Tool sections found in pyproject.toml, so a python gate is only assembled if configured. */
  readonly pythonTools: readonly string[];
}

const manifestsByType: Readonly<Record<ProjectType, string>> = {
  node: "package.json",
  python: "pyproject.toml",
  rust: "Cargo.toml",
  go: "go.mod",
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
  let nodeScripts: readonly string[] = [];
  let pythonTools: readonly string[] = [];

  for (const [type, manifest] of Object.entries(manifestsByType) as [ProjectType, string][]) {
    const text = await read(manifest);
    if (text === null) {
      continue;
    }
    types.push(type);
    manifests.push(manifest);
    if (type === "node") {
      nodeScripts = readNodeScripts(text);
    }
    if (type === "python") {
      pythonTools = readPythonTools(text);
    }
  }

  return { types, manifests, nodeScripts, pythonTools };
}

function readNodeScripts(text: string): readonly string[] {
  try {
    const parsed = JSON.parse(text) as { scripts?: Record<string, unknown> };
    return Object.keys(parsed.scripts ?? {}).sort();
  } catch {
    // A package.json that does not parse still identifies the project; it just declares nothing.
    return [];
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
  return [...tools].sort();
}
