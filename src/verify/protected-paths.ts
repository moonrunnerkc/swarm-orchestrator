import type { ProtectedCategory } from "../config/swarm-toml.ts";

export interface ProtectedPathFinding {
  readonly path: string;
  readonly category: ProtectedCategory;
}

export interface ProtectedPathResult {
  /** Protected paths the change touched, allowed or not. */
  readonly changed: readonly ProtectedPathFinding[];
  /** The ones that make the change unacceptable: touched together with source, not allowed. */
  readonly violations: readonly ProtectedPathFinding[];
  readonly allowed: readonly ProtectedCategory[];
}

const lockfiles = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
]);
const manifests = new Set(["package.json", "pyproject.toml", "Pipfile", "Cargo.toml", "go.mod"]);
const testDirectories = new Set(["test", "tests", "__tests__", "spec", "specs", "testing"]);
const testConfig =
  /^(?:(?:jest|vitest|mocha|karma|playwright|cypress|ava)\.config\.[cm]?[jt]s|\.mocharc\.[a-z]+|pytest\.ini|tox\.ini|setup\.cfg|conftest\.py|noxfile\.py)$/;
const testFile =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|^test_.*\.py$|_test\.py$|_test\.go$|Test\.java$|_spec\.rb$)/;
const ciFiles = new Set([".gitlab-ci.yml", ".travis.yml", "azure-pipelines.yml", "Jenkinsfile"]);
const ciDirectories = [".github/", ".circleci/", ".buildkite/"];
// Files that change how a check's Node or Python processes start, and so what loads first.
const startupFiles = /^(?:\.npmrc|\.yarnrc(?:\.yml)?|sitecustomize\.py|usercustomize\.py|.*\.pth)$/;

/** The protected category a path belongs to, or null for source. */
export function categoryOf(path: string): ProtectedCategory | null {
  const segments = path.split("/");
  const name = segments.at(-1) ?? path;
  if (path === "swarm.toml" || path.startsWith(".swarm/") || startupFiles.test(name))
    return "config";
  if (ciFiles.has(path) || ciDirectories.some((prefix) => path.startsWith(prefix))) return "ci";
  if (lockfiles.has(name)) return "lockfiles";
  if (manifests.has(name)) return "manifests";
  if (testConfig.test(name) || testFile.test(name)) return "tests";
  if (segments.slice(0, -1).some((segment) => testDirectories.has(segment))) return "tests";
  return null;
}

/**
 * Protected paths may change on their own, but not in the same change as source unless
 * swarm.toml allows that category. The allowance is read from the base, never the change.
 */
export function checkProtectedPaths(
  paths: readonly string[],
  allowed: readonly ProtectedCategory[],
): ProtectedPathResult {
  const changed: ProtectedPathFinding[] = [];
  let touchesSource = false;
  for (const path of paths) {
    const category = categoryOf(path);
    if (category === null) touchesSource = true;
    else changed.push({ path, category });
  }
  const violations = touchesSource
    ? changed.filter((finding) => !allowed.includes(finding.category))
    : [];
  return { changed, violations, allowed };
}
