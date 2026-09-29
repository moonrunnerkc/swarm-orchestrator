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

/** A PEP 517 build system as a manifest declares it, checked before anything is fetched for it. */
export interface PythonBuildSystem {
  readonly requires: readonly string[];
  readonly backend: string;
  readonly backendPath: readonly string[];
}

export type UvEditableProject =
  | ({ readonly kind: "editable" } & PythonBuildSystem)
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The build system a source tree declares, with PEP 517's own default where the manifest (or
 * the manifest itself) is absent. Refused where it names something other than registry
 * requirements, a module path, or directories inside the tree.
 */
export async function buildSystemOf(
  directory: string,
): Promise<PythonBuildSystem | { readonly refused: string }> {
  let manifest: { "build-system"?: Record<string, unknown> } = {};
  try {
    manifest = parseToml(
      await readFile(join(directory, "pyproject.toml"), "utf8"),
    ) as typeof manifest;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT")
      return { refused: "pyproject.toml could not be read" };
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
      refused: "build-system.requires names something other than plain registry requirements",
    };
  if (typeof backend !== "string" || !backendObject.test(backend))
    return { refused: "build-system.build-backend is not a module path" };
  if (
    !Array.isArray(backendPath) ||
    !backendPath.every((entry) => typeof entry === "string" && relativeBackendPath.test(entry))
  )
    return { refused: "build-system.backend-path must name directories inside the project" };
  return { requires, backend, backendPath };
}

interface UvLockPackage {
  name?: unknown;
  version?: unknown;
  source?: Record<string, unknown>;
  sdist?: { url?: unknown; hash?: unknown };
  wheels?: unknown[];
}

async function uvLockPackages(workspace: string): Promise<UvLockPackage[] | null> {
  try {
    const lock = parseToml(await readFile(join(workspace, "uv.lock"), "utf8")) as {
      package?: UvLockPackage[];
    };
    return lock.package ?? [];
  } catch {
    return null;
  }
}

/**
 * The project uv would install into its own environment and `--no-install-project` did not: the
 * lockfile's package whose source is the checkout itself, editable. A virtual project (no build
 * system) has nothing to install and reads null.
 */
export async function uvEditableProject(workspace: string): Promise<UvEditableProject | null> {
  const packages = await uvLockPackages(workspace);
  if (packages === null || !packages.some((entry) => entry?.source?.editable === ".")) return null;
  const system = await buildSystemOf(workspace);
  return "refused" in system
    ? { kind: "refused", reason: system.refused }
    : { kind: "editable", ...system };
}

/** A package uv would have to build: a registry release with only a source archive, or a local tree. */
export type UvSourceBuild =
  | {
      readonly kind: "archive";
      readonly name: string;
      readonly version: string;
      readonly url: string;
      readonly hash: string;
      readonly file: string;
    }
  | {
      readonly kind: "tree";
      readonly name: string;
      readonly path: string;
      readonly editable: boolean;
    };

export interface UvSourceBuildPlan {
  readonly builds: readonly UvSourceBuild[];
  /** Packages that cannot be built safely here, each with the reason, left out of the install. */
  readonly leftOut: readonly { readonly name: string; readonly reason: string }[];
}

/** A normalized distribution name, which is also what keeps it from being read as a flag. */
const distributionName = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const archiveFile = /^[A-Za-z0-9_.+-]+\.(?:tar\.gz|tgz|zip)$/;
const archiveHash = /^sha256:[0-9a-f]{64}$/;
const relativeTree = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+$/;

/**
 * Every locked package that installing would build, which the lockfile install now leaves out
 * (`--no-build` refuses them otherwise) so that nothing registry-served executes while the
 * registry is reachable. A release that ships only a source archive is rebuilt offline from the
 * archive's bytes, checked against the lockfile's hash; a workspace member or local directory is
 * built offline from the checkout. A git source, a local archive or an archive whose name or
 * hash cannot be checked is left out with its reason: fetching or building it here would need
 * code run with the network on, so a check that needs it reads what it is, not a pass.
 */
export async function uvSourceBuilds(workspace: string): Promise<UvSourceBuildPlan> {
  const packages = await uvLockPackages(workspace);
  const builds: UvSourceBuild[] = [];
  const leftOut: { name: string; reason: string }[] = [];
  for (const entry of packages ?? []) {
    const source = entry.source ?? {};
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!distributionName.test(name) || source.editable === "." || "virtual" in source) continue;
    const version = typeof entry.version === "string" ? entry.version : "";
    const wheels = Array.isArray(entry.wheels) ? entry.wheels.length : 0;
    if (typeof source.editable === "string" || typeof source.directory === "string") {
      const path = String(source.editable ?? source.directory);
      if (relativeTree.test(path))
        builds.push({ kind: "tree", name, path, editable: typeof source.editable === "string" });
      else leftOut.push({ name, reason: "its source directory is outside the checkout" });
      continue;
    }
    if (typeof source.git === "string") {
      leftOut.push({
        name,
        reason: "it comes from a git source, which would be fetched and built with its code run",
      });
      continue;
    }
    const remote = typeof source.registry === "string" || typeof source.url === "string";
    if (!remote || wheels > 0 || entry.sdist === undefined) {
      if (typeof source.path === "string" && wheels === 0 && !source.path.endsWith(".whl"))
        leftOut.push({ name, reason: "it is a local source archive, which is not built here" });
      continue;
    }
    const url = String(entry.sdist.url ?? source.url ?? "");
    const hash = String(entry.sdist.hash ?? "");
    const file = decodeURIComponent(url.split(/[?#]/)[0]?.split("/").at(-1) ?? "");
    if (!/^https?:\/\//.test(url) || !archiveFile.test(file) || !archiveHash.test(hash)) {
      leftOut.push({
        name,
        reason: "its source archive has no http(s) address, archive name or sha256 to check",
      });
      continue;
    }
    builds.push({ kind: "archive", name, version, url, hash, file });
  }
  return { builds, leftOut };
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
 * Runs a PEP 517 backend's hooks the way a build frontend does, with the fetched build
 * requirements and the declared backend path as the only packages on sys.path (`-I -S` keeps the
 * project environment's own packages out). The first argument is `requires` (print the
 * backend's extra requirements as JSON) or `build` (write the wheel and print its file name); the
 * second is `editable` or `wheel`. The backend's own printing goes to stderr so stdout carries
 * only the answer.
 */
export const pep517BuildScript = [
  "import importlib, json, os, sys",
  "mode, kind, root, wheels, spec = sys.argv[1:6]",
  "sys.path.insert(0, os.path.abspath(root))",
  "for entry in reversed(sys.argv[6:]):",
  "    sys.path.insert(0, os.path.abspath(entry))",
  "answer, sys.stdout = sys.stdout, sys.stderr",
  'module, _, attribute = spec.partition(":")',
  "backend = importlib.import_module(module)",
  'for part in filter(None, attribute.split(".")):',
  "    backend = getattr(backend, part)",
  'if not hasattr(backend, "build_" + kind):',
  '    sys.stderr.write("the build backend has no build_" + kind + " hook\\n")',
  "    sys.exit(3)",
  'if mode == "requires":',
  '    hook = getattr(backend, "get_requires_for_build_" + kind, None)',
  "    result = json.dumps(list(hook()) if hook else [])",
  "else:",
  "    os.makedirs(wheels, exist_ok=True)",
  '    result = getattr(backend, "build_" + kind)(os.path.abspath(wheels))',
  "answer.write(result)",
  "answer.flush()",
].join("\n");

/**
 * Fetches one source archive's bytes and keeps them only if their sha256 is the lockfile's. Run
 * by the image's own interpreter with `-I -S`, so nothing the registry served is on its path and
 * nothing in the archive is executed.
 */
export const archiveFetchScript = [
  "import hashlib, os, sys, urllib.request",
  "url, destination, expected = sys.argv[1:4]",
  'if not url.startswith(("https://", "http://")):',
  '    sys.exit("only an http(s) archive is fetched")',
  "with urllib.request.urlopen(url, timeout=120) as response:",
  "    data = response.read()",
  'digest = "sha256:" + hashlib.sha256(data).hexdigest()',
  "if digest != expected:",
  '    sys.exit("archive digest " + digest + " is not the lockfile\'s " + expected)',
  "os.makedirs(os.path.dirname(destination), exist_ok=True)",
  'with open(destination, "wb") as out:',
  "    out.write(data)",
].join("\n");

/**
 * Unpacks a source archive with the standard library's own path checks (the tar `data` filter
 * refuses absolute paths, links out of the tree and device files; zip extraction drops `..`).
 */
export const archiveExtractScript = [
  "import os, sys, tarfile, zipfile",
  "archive, destination = sys.argv[1:3]",
  "os.makedirs(destination, exist_ok=True)",
  'if archive.endswith(".zip"):',
  "    with zipfile.ZipFile(archive) as bundle:",
  "        bundle.extractall(destination)",
  "else:",
  "    with tarfile.open(archive) as bundle:",
  '        bundle.extractall(destination, filter="data")',
].join("\n");

export const wheelFileName = /^[A-Za-z0-9_.+-]+\.whl$/;
