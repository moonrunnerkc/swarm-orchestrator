import { pathsInPatch } from "./patch-paths.ts";

/**
 * Files that configure the instruments the repository's checks run: which tests a runner
 * collects, what runs in its own process before and after them, how a linter or type checker
 * reads the tree. The commands already come from the base commit's manifests, so a patch cannot
 * choose the instrument that measures it; these files are the rest of that instrument. A Vitest
 * configuration runs in the process that writes the report the verdict reads, and a patch that
 * added one wrote a passing report and exited before any test ran.
 *
 * A pattern list is a heuristic. A configuration that imports a helper module the patch changed,
 * or a setup file named some other way, is not caught here; it is named as a residual rather
 * than claimed.
 */
const runnerConfiguration: readonly RegExp[] = [
  /(^|\/)(vitest|vite|jest|playwright|cypress|ava|karma|webpack|rollup)\.(config|workspace|setup)\.[cm]?[jt]sx?$/,
  /(^|\/)vitest\.workspace\.json$/,
  /(^|\/)jest\.config\.json$/,
  /(^|\/)\.mocharc(\.(c?js|json|jsonc|ya?ml))?$/,
  /(^|\/)(babel\.config\.(c?js|json|mjs|cts|ts)|\.babelrc(\.(c?js|json|mjs))?)$/,
  /(^|\/)(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.(c?js|json|ya?ml))?|\.eslintignore)$/,
  /(^|\/)(prettier\.config\.[cm]?js|\.prettierrc(\.(c?js|json|ya?ml|toml))?|\.prettierignore)$/,
  /(^|\/)(biome\.jsonc?|tsconfig(\.[\w-]+)?\.json|\.swcrc)$/,
  /(^|\/)(conftest\.py|pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|noxfile\.py|\.coveragerc)$/,
  /(^|\/)(global-?setup|global-?teardown|setup-?tests|test-?setup|vitest\.setup)\.[cm]?[jt]sx?$/i,
];

export function isRunnerConfiguration(path: string): boolean {
  return runnerConfiguration.some((pattern) => pattern.test(path));
}

/** The runner configuration a patch changes, adds or deletes. */
export function runnerConfigurationChanged(patch: string): readonly string[] {
  return pathsInPatch(patch).filter(isRunnerConfiguration);
}
