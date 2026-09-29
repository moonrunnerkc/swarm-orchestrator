import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

/**
 * The lifecycle work a scripts-off install leaves undone, read from the lockfile and manifest
 * as data. Nothing here runs anything: it names what the offline phase would run, and refuses a
 * name that could not be passed to a command as one plain argument.
 */

/** An npm package name as the registry allows it, which also rules out anything read as a flag. */
const npmPackageName = /^(?:@[A-Za-z0-9][\w.~-]*\/)?[A-Za-z0-9][\w.~-]*$/;

export interface NpmDeferredScripts {
  /** Installed dependencies whose lockfile entry says they carry an install script. */
  readonly packages: readonly string[];
  /** Lockfile entries that claim a script under a name no command should be handed. */
  readonly refused: readonly string[];
}

/**
 * The dependencies whose install scripts `npm ci --ignore-scripts` skipped, from the lockfile's
 * own `hasInstallScript` (lockfile version 2 and later; version 1 records none). The project's
 * own scripts and workspace members are not dependencies the registry served and are left out,
 * as is an optional dependency that was not installed on this platform.
 */
export async function npmDeferredScripts(workspace: string): Promise<NpmDeferredScripts> {
  let lock: { packages?: Record<string, { hasInstallScript?: unknown; name?: unknown }> };
  try {
    lock = JSON.parse(await readFile(join(workspace, "package-lock.json"), "utf8"));
  } catch {
    return { packages: [], refused: [] };
  }
  const packages = new Set<string>();
  const refused = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (entry?.hasInstallScript !== true || !path.includes("node_modules/")) continue;
    const name =
      typeof entry.name === "string"
        ? entry.name
        : path.slice(path.lastIndexOf("node_modules/") + 13);
    if (!npmPackageName.test(name)) {
      refused.add(name);
      continue;
    }
    const installed = await lstat(join(workspace, path, "package.json")).then(
      () => true,
      () => false,
    );
    if (installed) packages.add(name);
  }
  return { packages: [...packages].sort(), refused: [...refused].sort() };
}

/**
 * Prints the running node's install prefix where that prefix carries node's own headers, and
 * nothing otherwise. node-gyp downloads headers unless told where local ones are, and offline
 * that download is refused, so a native build needs this to be possible at all.
 */
export const nodeHeadersProbeScript =
  'const p=require("node:path").dirname(require("node:path").dirname(process.execPath));' +
  'if(require("node:fs").existsSync(p+"/include/node/node_api.h"))process.stdout.write(p)';

/**
 * A PEP 508 requirement without a URL, a path or an option: a name, extras, version clauses and
 * an environment marker. Anything else (a direct reference, a flag) is refused, since it would
 * name something to fetch other than a registry release.
 */
const plainRequirement =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\[[A-Za-z0-9._,\s-]*\])?\s*(?:(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+\s*(?:,\s*(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+\s*)*)?(?:;\s*[A-Za-z0-9_.\s'"<>=!~(),-]+)?$/;

export function isPlainRequirement(requirement: string): boolean {
  return plainRequirement.test(requirement);
}

const backendObject = /^[A-Za-z_][\w.]*(?::[A-Za-z_][\w.]*)?$/;
const relativeBackendPath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+$/;

export type UvEditableProject =
  | {
      readonly kind: "editable";
      readonly requires: readonly string[];
      readonly backend: string;
      readonly backendPath: readonly string[];
    }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The project uv would install into its own environment and `--no-install-project` did not: the
 * lockfile's package whose source is the checkout itself, editable. A virtual project (no build
 * system) has nothing to install and reads null. The build system is read from the manifest,
 * with PEP 517's own default where the manifest declares none.
 */
export async function uvEditableProject(workspace: string): Promise<UvEditableProject | null> {
  let lock: { package?: { source?: { editable?: unknown } }[] };
  try {
    lock = parseToml(await readFile(join(workspace, "uv.lock"), "utf8")) as typeof lock;
  } catch {
    return null;
  }
  if (!(lock.package ?? []).some((entry) => entry?.source?.editable === ".")) return null;
  let manifest: { "build-system"?: Record<string, unknown> };
  try {
    manifest = parseToml(
      await readFile(join(workspace, "pyproject.toml"), "utf8"),
    ) as typeof manifest;
  } catch {
    return { kind: "refused", reason: "pyproject.toml could not be read" };
  }
  const system = manifest["build-system"];
  const requires = system?.requires ?? ["setuptools>=40.8.0"];
  const backend = system?.["build-backend"] ?? "setuptools.build_meta:__legacy__";
  const backendPath = system?.["backend-path"] ?? [];
  if (
    !Array.isArray(requires) ||
    !requires.every((entry) => typeof entry === "string" && isPlainRequirement(entry))
  )
    return {
      kind: "refused",
      reason: "build-system.requires names something other than plain registry requirements",
    };
  if (typeof backend !== "string" || !backendObject.test(backend))
    return { kind: "refused", reason: "build-system.build-backend is not a module path" };
  if (
    !Array.isArray(backendPath) ||
    !backendPath.every((entry) => typeof entry === "string" && relativeBackendPath.test(entry))
  )
    return {
      kind: "refused",
      reason: "build-system.backend-path must name directories inside the project",
    };
  return { kind: "editable", requires, backend, backendPath };
}

/** The `major.minor` of the interpreter uv made the environment from, read from pyvenv.cfg. */
export async function uvEnvironmentPython(workspace: string): Promise<string | null> {
  try {
    const config = await readFile(join(workspace, ".venv", "pyvenv.cfg"), "utf8");
    return /^version_info\s*=\s*(\d+\.\d+)/m.exec(config)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Runs a PEP 517 backend's editable hooks the way a build frontend does, with the fetched build
 * requirements and the declared backend path as the only packages on sys.path (`-I -S` keeps the
 * project environment's own packages out). `requires` prints the backend's extra requirements
 * as JSON; `build` writes the editable wheel and prints its file name. The backend's own
 * printing goes to stderr so stdout carries only the answer.
 */
export const editableBuildScript = [
  "import importlib, json, os, sys",
  "mode, root, wheels, spec = sys.argv[1:5]",
  "sys.path.insert(0, os.path.abspath(root))",
  "for entry in reversed(sys.argv[5:]):",
  "    sys.path.insert(0, os.path.abspath(entry))",
  "answer, sys.stdout = sys.stdout, sys.stderr",
  'module, _, attribute = spec.partition(":")',
  "backend = importlib.import_module(module)",
  'for part in filter(None, attribute.split(".")):',
  "    backend = getattr(backend, part)",
  'if not hasattr(backend, "build_editable"):',
  '    sys.stderr.write("the build backend has no build_editable hook (PEP 660)\\n")',
  "    sys.exit(3)",
  'if mode == "requires":',
  '    hook = getattr(backend, "get_requires_for_build_editable", None)',
  "    result = json.dumps(list(hook()) if hook else [])",
  "else:",
  "    os.makedirs(wheels, exist_ok=True)",
  "    result = backend.build_editable(os.path.abspath(wheels))",
  "answer.write(result)",
  "answer.flush()",
].join("\n");

export const wheelFileName = /^[A-Za-z0-9_.+-]+\.whl$/;
