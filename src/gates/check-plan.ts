import { access, readFile, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { discoverPackages } from "../config/package-discovery.ts";
import { nodeScriptCandidates } from "./node-gates.ts";
import { readNoninteractive } from "./noninteractive-runner.ts";
import { packageSelection } from "./package-scope.ts";
import { detectProject, type ProjectDetection } from "./project-type.ts";

/**
 * What a first run would do before it does it: the project the metadata describes, the test
 * command it declares, the scope that command can vouch for, and what is missing before any of
 * it can run. Read from files only. Nothing here executes a project script, installs anything,
 * or writes to the workspace, so the plan is safe to print for a repository nobody trusts yet.
 */
export const checkPlanVersion = "swarm.check-plan.v1";

export interface CheckPrerequisite {
  /** What is absent, in the project's own terms. */
  readonly what: string;
  /** The exact next step, grounded in this project's manifests. */
  readonly remedy: string;
}

export type CheckScopeKind = "root" | "packages" | "ambiguous" | "no-manifest";

export interface CheckScope {
  readonly kind: CheckScopeKind;
  /** Repository-relative units the checks cover; `.` for the root. */
  readonly selected: readonly string[];
  readonly detail: string;
}

export interface DeclaredCheck {
  readonly id: string;
  /** The declared command, or null where the project declares none. */
  readonly command: string | null;
  readonly unavailable: string | null;
}

export interface CheckPlan {
  readonly version: typeof checkPlanVersion;
  readonly workspace: string;
  readonly project: {
    readonly types: ProjectDetection["types"];
    readonly manifests: readonly string[];
    readonly nodeManager: string | null;
    readonly lockfiles: readonly string[];
    readonly pythonCommand: string | null;
    readonly setupProblem: string | null;
  };
  /** Workspace units the root manifest declares, whether or not they are selected. */
  readonly packages: readonly string[];
  readonly scope: CheckScope;
  readonly tests: {
    readonly script: string | null;
    readonly body: string | null;
    readonly runner: string;
    readonly noninteractiveBy: readonly string[];
    readonly interactive: string | null;
  };
  readonly declaredChecks: readonly DeclaredCheck[];
  readonly prerequisites: readonly CheckPrerequisite[];
  /** Areas this plan cannot measure, each with its reason, so a pass is never read wider. */
  readonly unmeasured: readonly { readonly area: string; readonly reason: string }[];
}

export interface CheckPlanInput {
  readonly workspace: string;
  readonly packages?: readonly string[];
  /** The `PATH` to look programs up on. Injected so a test can name an empty one. */
  readonly path?: string;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

async function onPath(program: string, path: string): Promise<boolean> {
  for (const directory of path.split(delimiter).filter((entry) => entry.length > 0)) {
    if (await exists(join(directory, program))) return true;
  }
  return false;
}

const lockfileNames = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "uv.lock"];

/** Plan a check over a workspace from its files alone. */
export async function planCheck(input: CheckPlanInput): Promise<CheckPlan> {
  const path = input.path ?? process.env.PATH ?? "";
  const root = input.workspace;
  const read = (file: string) => readFile(join(root, file), "utf8").catch(() => null);
  const detection = await detectProject(read);
  const lockfiles: string[] = [];
  for (const name of lockfileNames) if (await exists(join(root, name))) lockfiles.push(name);

  let packages: readonly string[] = [];
  let discoveryProblem: string | null = null;
  if (detection.types.includes("node")) {
    try {
      packages = await discoverPackages(root);
    } catch (cause) {
      discoveryProblem = cause instanceof Error ? cause.message : String(cause);
    }
  }

  const testScript =
    (nodeScriptCandidates.tests ?? []).find((name) => detection.nodeScripts.includes(name)) ?? null;
  const testBody = testScript === null ? null : (detection.nodeScriptCommands[testScript] ?? "");
  const pythonTests =
    detection.types.includes("python") && detection.pythonTools.includes("pytest");
  const reading = readNoninteractive(
    testBody ?? (pythonTests ? `${detection.pythonCommand ?? "python -m"} pytest -q` : undefined),
  );

  const selected =
    input.packages && input.packages.length > 0 ? packageSelection(input.packages) : null;
  const scope = scopeOf(detection, packages, selected, testScript, pythonTests, discoveryProblem);

  const declaredChecks = declaredChecksOf(detection, pythonTests);
  const prerequisites = await prerequisitesOf(detection, root, path, scope, lockfiles);
  const unmeasured: { area: string; reason: string }[] = [
    {
      area: "task correctness",
      reason:
        "no requirement contract was supplied, so whether the work does what was asked is not judged",
    },
  ];
  if (scope.kind === "root" && packages.length > 0)
    unmeasured.push({
      area: `${packages.length} workspace package(s)`,
      reason:
        "the root test script ran; whether it covers each package is not established, so package-qualified checks stay unmeasured. Select packages with --package to measure them by name",
    });
  for (const check of declaredChecks)
    if (check.unavailable !== null) unmeasured.push({ area: check.id, reason: check.unavailable });
  for (const type of detection.types)
    if (type === "rust" || type === "go")
      unmeasured.push({
        area: `${type} toolchain`,
        reason: `${type} projects run their repository-wide commands as declared; discovery here reads only Node and Python metadata`,
      });

  return {
    version: checkPlanVersion,
    workspace: root,
    project: {
      types: detection.types,
      manifests: detection.manifests,
      nodeManager: detection.types.includes("node") ? (detection.nodeManager ?? "npm") : null,
      lockfiles,
      pythonCommand: detection.pythonCommand ?? null,
      setupProblem: detection.setupProblem ?? null,
    },
    packages,
    scope,
    tests: {
      script: testScript,
      body: testBody,
      runner: reading.runner,
      noninteractiveBy: reading.noninteractiveBy,
      interactive: reading.interactive,
    },
    declaredChecks,
    prerequisites,
    unmeasured,
  };
}

function scopeOf(
  detection: ProjectDetection,
  packages: readonly string[],
  selected: readonly string[] | null,
  testScript: string | null,
  pythonTests: boolean,
  discoveryProblem: string | null,
): CheckScope {
  if (detection.types.length === 0)
    return {
      kind: "no-manifest",
      selected: [],
      detail:
        "no package.json, pyproject.toml, setup.cfg, setup.py, Cargo.toml or go.mod in the workspace root, so no check can be discovered here",
    };
  if (selected !== null)
    return {
      kind: "packages",
      selected,
      detail: `the ${selected.length} selected package(s) are checked by name; nothing outside them is`,
    };
  if (discoveryProblem !== null)
    return {
      kind: "ambiguous",
      selected: [],
      detail: `${discoveryProblem}. Name the units to check with --package <dir>`,
    };
  if (packages.length > 0 && testScript === null && !pythonTests)
    return {
      kind: "ambiguous",
      selected: [],
      detail:
        `the root manifest declares ${packages.length} workspace package(s) and no root test script, so no single command covers the repository. ` +
        `Name the units to check with --package <dir>: ${packages.slice(0, 8).join(", ")}${packages.length > 8 ? ", ..." : ""}`,
    };
  return {
    kind: "root",
    selected: ["."],
    detail:
      packages.length > 0
        ? `the root test script runs over a workspace of ${packages.length} package(s)`
        : "the root manifest declares the checks for the whole repository",
  };
}

function declaredChecksOf(
  detection: ProjectDetection,
  pythonTests: boolean,
): readonly DeclaredCheck[] {
  const checks: DeclaredCheck[] = [];
  if (detection.types.includes("node")) {
    const manager = detection.nodeManager ?? "npm";
    for (const id of ["tests", "typecheck", "lint", "format", "build"]) {
      const script =
        (nodeScriptCandidates[id] ?? []).find((name) => detection.nodeScripts.includes(name)) ??
        null;
      checks.push({
        id: detection.types.length > 1 ? `${id}:node` : id,
        command: script === null ? null : `${manager} run --silent ${script}`,
        unavailable:
          script === null
            ? id === "tests"
              ? "package.json declares no test script, so nothing executes the code"
              : `package.json declares no ${id === "format" ? "check-only format" : id} script`
            : null,
      });
    }
  }
  if (detection.types.includes("python")) {
    const prefix = detection.pythonCommand === undefined ? "" : `${detection.pythonCommand} `;
    const suffix = detection.types.length > 1 ? ":python" : "";
    checks.push(
      {
        id: `tests${suffix}`,
        command: pythonTests ? `${prefix}pytest -q` : null,
        unavailable: pythonTests
          ? null
          : "the project declares no pytest dependency or configuration, so nothing executes the code",
      },
      {
        id: `lint${suffix}`,
        command: detection.pythonTools.includes("ruff") ? `${prefix}ruff check --no-fix .` : null,
        unavailable: detection.pythonTools.includes("ruff") ? null : "no linter is configured",
      },
      {
        id: `typecheck${suffix}`,
        command: detection.pythonTools.includes("mypy") ? `${prefix}mypy` : null,
        unavailable: detection.pythonTools.includes("mypy")
          ? null
          : "no type checker is configured",
      },
    );
  }
  return checks;
}

/** Whether the root manifest names any dependency at all; a project with none needs no install. */
async function declaresDependencies(root: string): Promise<boolean> {
  const text = await readFile(join(root, "package.json"), "utf8").catch(() => null);
  if (text === null) return false;
  try {
    const manifest = JSON.parse(text) as Record<string, unknown>;
    return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].some(
      (field) =>
        typeof manifest[field] === "object" &&
        manifest[field] !== null &&
        Object.keys(manifest[field] as object).length > 0,
    );
  } catch {
    return false;
  }
}

async function prerequisitesOf(
  detection: ProjectDetection,
  root: string,
  path: string,
  scope: CheckScope,
  lockfiles: readonly string[],
): Promise<readonly CheckPrerequisite[]> {
  const missing: CheckPrerequisite[] = [];
  if (detection.setupProblem !== undefined)
    missing.push({ what: detection.setupProblem, remedy: "repair the manifest, then run again" });
  const units = scope.kind === "packages" ? scope.selected : ["."];
  if (detection.types.includes("node")) {
    const manager = detection.nodeManager ?? "npm";
    if (!(await onPath("node", path)))
      missing.push({ what: "node is not on PATH", remedy: "install Node 22 or newer" });
    if (!(await onPath(manager, path)))
      missing.push({
        what: `${manager} is not on PATH`,
        remedy:
          manager === "npm"
            ? "install npm"
            : `install ${manager}: \`npm install -g ${manager}\` (the version the manifest pins under packageManager, where it pins one), or \`corepack enable\``,
      });
    if (lockfiles.includes("yarn.lock") || lockfiles.includes("bun.lockb"))
      missing.push({
        what: `the lockfile is ${lockfiles.includes("yarn.lock") ? "yarn.lock" : "bun.lockb"}, which this verifier does not drive`,
        remedy: "npm and pnpm projects are supported; name the exact command with --command",
      });
    const installed = await isDirectory(join(root, "node_modules"));
    if (!installed && (await declaresDependencies(root)))
      missing.push({
        what: "dependencies are not installed (no node_modules directory)",
        remedy:
          manager === "pnpm"
            ? "run `pnpm install --frozen-lockfile` in the workspace, then run again"
            : lockfiles.includes("package-lock.json")
              ? "run `npm ci` in the workspace, then run again"
              : "run `npm install` in the workspace, then run again",
      });
    for (const unit of units)
      if (unit !== "." && !(await isDirectory(join(root, unit, "node_modules"))) && !installed)
        missing.push({
          what: `${unit}: dependencies are not installed`,
          remedy: `install the workspace's dependencies with ${manager}, then run again`,
        });
  }
  if (detection.types.includes("python") && detection.pythonTools.length > 0) {
    if (detection.pythonCommand === undefined)
      missing.push({
        what: "no project interpreter: neither uv.lock nor .venv/pyvenv.cfg is present",
        remedy:
          "create the environment the project declares: `uv sync` for a uv project, or `python -m venv .venv && .venv/bin/pip install -e .` and the test extras, then run again",
      });
    else if (detection.pythonCommand.startsWith("uv ") && !(await onPath("uv", path)))
      missing.push({ what: "uv is not on PATH", remedy: "install uv, then run again" });
    else if (
      detection.pythonCommand.startsWith("uv ") &&
      !(await exists(join(root, ".venv", "pyvenv.cfg")))
    )
      // `uv run --no-sync` never creates the environment, so without one every check exits
      // in no time with uv's own error, which is not a finding about the project.
      missing.push({
        what: "dependencies are not installed (no .venv directory for the uv.lock)",
        remedy: "run `uv sync --locked` in the workspace, then run again",
      });
    else if (
      detection.pythonCommand.startsWith(".venv") &&
      !(await exists(join(root, ".venv", "bin", "python")))
    )
      missing.push({
        what: ".venv/pyvenv.cfg exists but .venv/bin/python does not",
        remedy: "recreate the virtual environment, then run again",
      });
  }
  return missing;
}
